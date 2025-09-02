import { NextRequest } from 'next/server';
import { z } from 'zod';
import { runResearch } from '@/lib/agents/researcher';
import { runAnalysis } from '@/lib/agents/analyst';
import { runStrategy } from '@/lib/agents/strategist';
import { writeFile, mkdir } from 'fs/promises';
import path from 'path';

const schema = z.object({
  topic: z.string().min(3),
  targetQuestions: z.array(z.string().min(3)).min(1),
  maxSources: z.number().int().min(3).max(10).optional(),
  audience: z.string().optional(),
  tone: z.string().optional(),
  useLLM: z.boolean().optional(),
  model: z.string().optional(),
});

export async function POST(req: NextRequest) {
  const encoder = new TextEncoder();
  try {
    const json = await req.json();
    const data = schema.parse(json);

  const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
    const send = (event: string, payload: unknown) => {
          controller.enqueue(encoder.encode(`event: ${event}\n`));
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
        };

        try {
          send('status', { phase: 'research', message: 'Starting research…' });
          const research = await runResearch({ topic: data.topic, maxSources: data.maxSources ?? 6 });
          send('status', { phase: 'research', message: `Found ${research.sources.length} sources` });

          send('status', { phase: 'analysis', message: 'Analyzing sources…' });
          const analysis = await runAnalysis({ sources: research.sources, useLLM: data.useLLM, model: data.model });
          send('status', { phase: 'analysis', message: `Analyzed ${analysis.analyzed.length} sources` });

          send('status', { phase: 'strategy', message: 'Drafting post…' });
          const strategy = await runStrategy({
            topic: data.topic,
            targetQuestions: data.targetQuestions,
            analyzed: analysis.analyzed,
            audience: data.audience,
            tone: data.tone,
            useLLM: data.useLLM,
            model: data.model,
          });

          send('status', { phase: 'save', message: 'Saving markdown…' });
          const postsDir = path.join(process.cwd(), 'content', 'posts');
          await mkdir(postsDir, { recursive: true });
          const filePath = path.join(postsDir, `${strategy.slug}.md`);
          await writeFile(filePath, strategy.markdown, 'utf8');
          send('done', { slug: strategy.slug, title: strategy.title });
          controller.close();
        } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : 'Unknown error';
          send('error', { message: msg });
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache, no-transform',
        connection: 'keep-alive',
        'access-control-allow-origin': '*',
      },
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Invalid request';
    return new Response(JSON.stringify({ ok: false, error: msg }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    });
  }
}
