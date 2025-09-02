import { load, CheerioAPI } from 'cheerio';
import type { Element } from 'domhandler';
import slugify from 'slugify';
import { fetchWithRetry } from '@/lib/utils/retry';
import { logger } from '@/lib/utils/logger';
import { ExternalServiceError, NetworkError } from '@/lib/utils/errors';
import { sanitizeUrl, sanitizeText } from '@/lib/utils/validation';

export async function fetchHTML(url: string): Promise<string> {
  try {
    const sanitizedUrl = sanitizeUrl(url);
    logger.info('Fetching HTML', { component: 'web', url: sanitizedUrl });
    
    const response = await fetchWithRetry(sanitizedUrl, {
      headers: { 'user-agent': 'mr-blog-bot/1.0' }
    });
    
    const html = await response.text();
    logger.debug('HTML fetched successfully', { component: 'web', url: sanitizedUrl, size: html.length });
    
    return html;
  } catch (error) {
    logger.error('Failed to fetch HTML', { component: 'web', url }, error as Error);
    throw new NetworkError(`Failed to fetch HTML from ${url}`, { url });
  }
}

export async function extractMainContent(html: string): Promise<{ title: string; text: string }>{
  logger.debug('Extracting main content', { component: 'web', htmlSize: html.length });
  
  // Try unfluff first for better article extraction
  try {
    type UnfluffData = { title?: string; softTitle?: string; text?: string };
    type UnfluffFn = (html: string) => UnfluffData;
    type UnfluffModule = { default?: UnfluffFn } | UnfluffFn;
    const mod = (await import('unfluff')) as unknown as UnfluffModule;
    const fn: UnfluffFn | undefined = typeof mod === 'function' ? (mod as UnfluffFn) : (mod as { default?: UnfluffFn }).default;
    if (fn) {
      const data = fn(html) as UnfluffData;
      const title = sanitizeText(data?.title || data?.softTitle || '').trim();
      const text = sanitizeText(data?.text || '').replace(/\s+/g, ' ').trim();
      if (text && text.length > 200) {
        logger.debug('Content extracted with unfluff', { 
          component: 'web', 
          titleLength: title.length, 
          textLength: text.length 
        });
        return { title: title || 'Untitled', text };
      }
    }
  } catch (error) {
    logger.warn('Unfluff extraction failed, falling back to cheerio', 
      { component: 'web' }, error as Error);
  }
  
  // Fallback: cheerio heuristics
  try {
    const $: CheerioAPI = load(html);
    const title = sanitizeText($('title').first().text()).trim() || 'Untitled';
    const articleSelectors = ['article', 'main', '#content', '.content', '.post'];
    let text = '';
    for (const sel of articleSelectors) {
      const el = $(sel);
      if (el.length) {
        text = el.text();
        break;
      }
    }
    if (!text) text = $('body').text();
    text = sanitizeText(text).replace(/\s+/g, ' ').trim();
    
    logger.debug('Content extracted with cheerio', { 
      component: 'web', 
      titleLength: title.length, 
      textLength: text.length 
    });
    
    return { title, text };
  } catch (error) {
    logger.error('Content extraction failed completely', { component: 'web' }, error as Error);
    throw new Error('Failed to extract content from HTML');
  }
}

export function makeSlug(input: string): string {
  const sanitized = sanitizeText(input);
  return slugify(sanitized, { lower: true, strict: true });
}

export type SearchResult = { title: string; url: string; snippet?: string };

// Search proxy with proper error handling and validation
export async function searchWeb(query: string, max: number): Promise<SearchResult[]> {
  const sanitizedQuery = sanitizeText(query);
  logger.info('Starting web search', { component: 'web', query: sanitizedQuery, max });
  
  // Prefer SerpAPI if configured
  const apiKey = process.env.SERPAPI_API_KEY;
  if (apiKey) {
    try {
      logger.debug('Using SerpAPI for search', { component: 'web' });
      const url = `https://serpapi.com/search.json?engine=google&q=${encodeURIComponent(sanitizedQuery)}&num=${Math.min(max, 10)}&api_key=${apiKey}`;
      
      const response = await fetchWithRetry(url);
      const json = await response.json();
      
      const items = Array.isArray(json.organic_results) ? json.organic_results : [];
      const results: SearchResult[] = items.slice(0, max).map((it: unknown) => {
        const obj = it as Record<string, unknown>;
        const titleVal = sanitizeText(typeof obj.title === 'string' ? obj.title : (typeof obj.link === 'string' ? obj.link : 'Untitled'));
        const urlVal = typeof obj.link === 'string' ? obj.link : '';
        const snipVal = typeof obj.snippet === 'string' ? sanitizeText(obj.snippet) : undefined;
        return { title: titleVal, url: urlVal, snippet: snipVal };
      }).filter((r: SearchResult) => r.url && r.title);
      
      if (results.length) {
        logger.info('SerpAPI search successful', { 
          component: 'web', 
          query: sanitizedQuery, 
          resultsCount: results.length 
        });
        return results;
      }
    } catch (error) {
      logger.warn('SerpAPI search failed, falling back to DuckDuckGo', 
        { component: 'web', query: sanitizedQuery }, error as Error);
    }
  }
  
  // Fallback: DuckDuckGo HTML scraping
  try {
    logger.debug('Using DuckDuckGo for search', { component: 'web' });
    const q = encodeURIComponent(sanitizedQuery);
    const url = `https://duckduckgo.com/html/?q=${q}`;
    
    const response = await fetchWithRetry(url);
    const html = await response.text();
    const $: CheerioAPI = load(html);
    const results: SearchResult[] = [];
    
    $('a.result__a').each((_: number, el: Element) => {
      if (results.length >= max) return;
      
      const title = sanitizeText($(el).text()).trim();
      const href = $(el).attr('href');
      if (!href) return;
      
      const snip = sanitizeText($(el).closest('.result').find('.result__snippet').text()).trim();
      
      // DuckDuckGo wraps with /l/?kh=-1&uddg=<encoded>
      let realUrl = href;
      try {
        const m = href.match(/uddg=([^&]+)/);
        if (m) realUrl = decodeURIComponent(m[1]);
        // Validate the URL
        sanitizeUrl(realUrl);
      } catch (error) {
        logger.debug('Skipping invalid URL', { component: 'web', href, error: (error as Error).message });
        return;
      }
      
      results.push({ title, url: realUrl, snippet: snip });
    });
    
    logger.info('DuckDuckGo search completed', { 
      component: 'web', 
      query: sanitizedQuery, 
      resultsCount: results.length 
    });
    
    return results.slice(0, max);
  } catch (error) {
    logger.error('All search methods failed', { component: 'web', query: sanitizedQuery }, error as Error);
    throw new ExternalServiceError('Search', `Search failed for query: ${sanitizedQuery}`, { query: sanitizedQuery });
  }
}
