import { AnalysisInput, AnalysisOutput, AnalyzedSource } from './types';
import { chatComplete } from '@/lib/llm/openai';

function summarize(text: string, maxSentences = 3): string {
  const sentences = text
    .replace(/\s+/g, ' ')
    .match(/[^.!?]+[.!?]/g) || [text];
  return sentences.slice(0, maxSentences).join(' ').trim();
}

function extractBullets(text: string, max = 5): string[] {
  // Very naive key takeaway extraction: top N long-ish sentences
  const sentences = (text.match(/[^.!?]+[.!?]/g) || [])
    .map(s => s.trim())
    .filter(s => s.length > 60)
    .slice(0, max);
  return sentences.length ? sentences : [summarize(text, 1)];
}

export async function runAnalysis(input: AnalysisInput & { useLLM?: boolean; model?: string }): Promise<AnalysisOutput> {
  if (input.useLLM && process.env.OPENAI_API_KEY) {
    const analyzed: AnalyzedSource[] = [];
    for (const s of input.sources) {
      const prompt = `Summarize the following source into a concise paragraph (<=120 words) and extract 3-5 key takeaways as short bullet points. Respond in JSON with keys summary (string) and takeaways (string[]).

TITLE: ${s.title}
URL: ${s.url}
CONTENT:
${(s.content || s.snippet || '').slice(0, 8000)}
`;
      try {
        const content = await chatComplete([
          { role: 'system', content: 'You are an expert content analyst who writes concise, actionable summaries.' },
          { role: 'user', content: prompt },
        ], input.model || 'gpt-4o-mini', 0.3);
        let parsed: { summary?: string; takeaways?: string[] } = {};
        try { parsed = JSON.parse(content); } catch { /* fall back */ }
        analyzed.push({
          ...s,
          summary: parsed.summary || summarize(s.content || s.snippet || ''),
          keyTakeaways: parsed.takeaways && parsed.takeaways.length ? parsed.takeaways : extractBullets(s.content || s.snippet || ''),
        });
      } catch {
        analyzed.push({
          ...s,
          summary: summarize(s.content || s.snippet || ''),
          keyTakeaways: extractBullets(s.content || s.snippet || ''),
        });
      }
    }
    return { analyzed };
  }
  const analyzed: AnalyzedSource[] = input.sources.map((s) => ({
    ...s,
    summary: summarize(s.content || s.snippet || ''),
    keyTakeaways: extractBullets(s.content || s.snippet || ''),
  }));
  return { analyzed };
}
