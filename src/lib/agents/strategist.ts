import { StrategyInput, StrategyOutput } from './types';
import { makeSlug } from '@/lib/tools/web';
import dayjs from 'dayjs';
import { chatComplete } from '@/lib/llm/openai';

function buildOutline(topic: string, questions: string[], takeaways: string[][]) {
  const outline: Array<{ heading: string; points: string[] }> = [];
  outline.push({ heading: `Introduction to ${topic}`, points: [
    `Why ${topic} matters`,
    'What this post covers',
  ]});
  questions.forEach((q, i) => {
    outline.push({ heading: q, points: takeaways[i] ? takeaways[i].slice(0, 5) : [] });
  });
  outline.push({ heading: 'Conclusion', points: [
    'Key takeaways',
    'Next steps and further reading',
  ]});
  return outline;
}

function toMarkdown(title: string, outline: Array<{ heading: string; points: string[] }>, sources: { title: string; url: string }[], frontmatter: Record<string, unknown>): string {
  const fm = ['---', ...Object.entries(frontmatter).map(([k, v]) => `${k}: ${JSON.stringify(v)}`), '---'].join('\n');
  const body = [
    `# ${title}`,
    '',
    ...outline.flatMap(sec => [
      `## ${sec.heading}`,
      ...sec.points.map(p => `- ${p}`),
      '',
    ]),
    '## Sources',
    ...sources.map(s => `- [${s.title}](${s.url})`),
    '',
  ].join('\n');
  return `${fm}\n\n${body}`;
}

export async function runStrategy(input: StrategyInput & { useLLM?: boolean; model?: string }): Promise<StrategyOutput> {
  const { topic, targetQuestions, analyzed, audience = 'General tech audience', tone = 'Informative and concise' } = input;
  const title = `${topic}: Answers to ${targetQuestions.length} Key Questions`;
  const slug = makeSlug(`${dayjs().format('YYYY-MM-DD')}-${title}`);
  let outline = buildOutline(topic, targetQuestions, targetQuestions.map((_, i) => analyzed[i]?.keyTakeaways || []));
  if (input.useLLM && process.env.OPENAI_API_KEY) {
    const planPrompt = `You are a senior content strategist. Build a high-signal outline that answers the target questions and flows logically.
Return strict JSON with this shape: { outline: { heading: string; points: string[] }[] }.
Guidelines:
- Prioritize clarity and a logical progression.
- Use 4-7 sections total (incl. Intro and Conclusion).
- Each section should have 3-6 bullet points that will be expanded later.

Topic: ${topic}
Audience: ${audience}
Tone: ${tone}
Target Questions: ${JSON.stringify(targetQuestions)}
Evidence (summarized): ${JSON.stringify(analyzed.map(a => ({ title: a.title, keyTakeaways: a.keyTakeaways.slice(0,5) })))}
`;
    try {
      const outlineJson = await chatComplete([
        { role: 'system', content: 'You are a senior content strategist.' },
        { role: 'user', content: planPrompt },
      ], input.model || 'gpt-4o-mini', 0.4);
      const parsed = JSON.parse(outlineJson);
      if (Array.isArray(parsed?.outline)) {
        outline = parsed.outline;
      }
    } catch {/* fallback to heuristic outline */}
  }
  let markdown = toMarkdown(title, outline, analyzed.map(a => ({ title: a.title, url: a.url })), {
    title,
    date: dayjs().format('YYYY-MM-DD'),
    slug,
    topic,
    audience,
    tone,
  });
  if (input.useLLM && process.env.OPENAI_API_KEY) {
    const writePrompt = `Write an original blog post in clean Markdown.
Must:
- Include a "## Table of Contents" after the H1 with anchor links to sections.
- Use clear headings, short paragraphs, bullet lists, and occasional callouts.
- Paraphrase; do not copy source passages. Limit quotations to <2 short lines each.
- Use numbered in-text citations like [1], [2] when referencing facts, mapping to the Sources section.
- Keep a helpful, ${tone} tone for ${audience}.
- Avoid hallucinatory claims; stick to the provided evidence.

Return only Markdown (no frontmatter, no JSON).

TITLE: ${title}
OUTLINE: ${JSON.stringify(outline)}
SOURCES (indexed): ${JSON.stringify(analyzed.map((a, i) => ({ index: i+1, title: a.title, url: a.url })))}
`;
    try {
      const body = await chatComplete([
        { role: 'system', content: 'You are an expert blog writer who produces clean Markdown.' },
        { role: 'user', content: writePrompt },
      ], input.model || 'gpt-4o-mini', 0.5);
      markdown = ['---',
        `title: ${JSON.stringify(title)}`,
        `date: ${JSON.stringify(dayjs().format('YYYY-MM-DD'))}`,
        `slug: ${JSON.stringify(slug)}`,
        `topic: ${JSON.stringify(topic)}`,
        `audience: ${JSON.stringify(audience)}`,
        `tone: ${JSON.stringify(tone)}`,
        '---',
        '',
        body.trim()].join('\n');
    } catch {/* keep heuristic markdown */}
  }
  return { title, outline, markdown, slug, sources: analyzed.map(a => ({ title: a.title, url: a.url })) };
}
