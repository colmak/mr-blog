import { load, CheerioAPI } from 'cheerio';
import type { Element } from 'domhandler';
import slugify from 'slugify';

export async function fetchHTML(url: string): Promise<string> {
  const res = await fetch(url, { headers: { 'user-agent': 'mr-blog-bot/1.0' } });
  if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status}`);
  return await res.text();
}

export async function extractMainContent(html: string): Promise<{ title: string; text: string }>{
  // Try unfluff first for better article extraction
  try {
    type UnfluffData = { title?: string; softTitle?: string; text?: string };
    type UnfluffFn = (html: string) => UnfluffData;
    type UnfluffModule = { default?: UnfluffFn } | UnfluffFn;
    const mod = (await import('unfluff')) as unknown as UnfluffModule;
    const fn: UnfluffFn | undefined = typeof mod === 'function' ? (mod as UnfluffFn) : (mod as { default?: UnfluffFn }).default;
    if (fn) {
      const data = fn(html) as UnfluffData;
      const title = (data?.title || data?.softTitle || '').trim();
      const text = (data?.text || '').replace(/\s+/g, ' ').trim();
      if (text && text.length > 200) {
        return { title: title || 'Untitled', text };
      }
    }
  } catch {
    // ignore and fall back to cheerio
  }
  // Fallback: cheerio heuristics
  const $: CheerioAPI = load(html);
  const title = $('title').first().text().trim() || 'Untitled';
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
  text = text.replace(/\s+/g, ' ').trim();
  return { title, text };
}

export function makeSlug(input: string): string {
  return slugify(input, { lower: true, strict: true });
}

export type SearchResult = { title: string; url: string; snippet?: string };

// Very simple search proxy via DuckDuckGo HTML (no API key). For production, swap for SerpAPI/Bing.
export async function searchWeb(query: string, max: number): Promise<SearchResult[]> {
  // Prefer SerpAPI if configured
  const apiKey = process.env.SERPAPI_API_KEY;
  if (apiKey) {
    try {
      const url = `https://serpapi.com/search.json?engine=google&q=${encodeURIComponent(query)}&num=${Math.min(max, 10)}&api_key=${apiKey}`;
      const res = await fetch(url, { headers: { 'user-agent': 'mr-blog-bot/1.0' } });
      if (res.ok) {
        const json = await res.json();
        const items = Array.isArray(json.organic_results) ? json.organic_results : [];
        const results: SearchResult[] = items.slice(0, max).map((it: unknown) => {
          const obj = it as Record<string, unknown>;
          const titleVal = typeof obj.title === 'string' ? obj.title : (typeof obj.link === 'string' ? obj.link : 'Untitled');
          const urlVal = typeof obj.link === 'string' ? obj.link : '';
          const snipVal = typeof obj.snippet === 'string' ? obj.snippet : undefined;
          return { title: titleVal, url: urlVal, snippet: snipVal };
        }).filter((r: SearchResult) => r.url && r.title);
        if (results.length) return results;
      }
    } catch {
      // fall through to DuckDuckGo
    }
  }
  // Fallback: DuckDuckGo HTML scraping
  const q = encodeURIComponent(query);
  const url = `https://duckduckgo.com/html/?q=${q}`;
  const res = await fetch(url, { headers: { 'user-agent': 'mr-blog-bot/1.0' } });
  const html = await res.text();
  const $: CheerioAPI = load(html);
  const results: SearchResult[] = [];
  $('a.result__a').each((_: number, el: Element) => {
    if (results.length >= max) return;
    const title = $(el).text().trim();
    const href = $(el).attr('href');
    if (!href) return;
    const snip = $(el).closest('.result').find('.result__snippet').text().trim();
    // DuckDuckGo wraps with /l/?kh=-1&uddg=<encoded>
    let realUrl = href;
    try {
      const m = href.match(/uddg=([^&]+)/);
      if (m) realUrl = decodeURIComponent(m[1]);
    } catch {}
    results.push({ title, url: realUrl, snippet: snip });
  });
  return results.slice(0, max);
}
