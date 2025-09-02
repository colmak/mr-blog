import { ResearchInput, ResearchOutput, Source } from './types';
import { searchWeb, fetchHTML, extractMainContent } from '@/lib/tools/web';

export async function runResearch(input: ResearchInput): Promise<ResearchOutput> {
  const { topic } = input;
  const cap = Math.min(Math.max(input.maxSources ?? 6, 1), 10);

  const queries = [
    `${topic} overview`,
    `${topic} latest news`,
    `${topic} research analysis`,
    `${topic} trends 2025`,
  ];

  const seen = new Set<string>();
  const sources: Source[] = [];

  for (const q of queries) {
    if (sources.length >= cap) break;
    const results = await searchWeb(q, cap);
    for (const r of results) {
      if (sources.length >= cap) break;
      const key = r.url.replace(/[#?].*$/, '');
      if (seen.has(key)) continue;
      seen.add(key);
      try {
        const html = await fetchHTML(r.url);
        const { title, text } = await extractMainContent(html);
        const body = text.replace(/\s+/g, ' ').trim();
        if (body.length < 500) continue; // skip thin/throttled pages
        sources.push({ title: r.title || title, url: r.url, snippet: r.snippet, content: body.slice(0, 15000) });
      } catch {
        // ignore failures per-url
      }
    }
  }

  // Fallback: try plain topic if we have too few
  if (sources.length < Math.min(3, cap)) {
    const results = await searchWeb(topic, cap);
    for (const r of results) {
      if (sources.length >= cap) break;
      const key = r.url.replace(/[#?].*$/, '');
      if (seen.has(key)) continue;
      seen.add(key);
      try {
        const html = await fetchHTML(r.url);
        const { title, text } = await extractMainContent(html);
        const body = text.replace(/\s+/g, ' ').trim();
        if (body.length < 500) continue;
        sources.push({ title: r.title || title, url: r.url, snippet: r.snippet, content: body.slice(0, 15000) });
      } catch {
        // ignore
      }
    }
  }

  return { sources };
}
