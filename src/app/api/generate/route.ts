import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { generatePost } from '@/lib/orchestrator';
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
  try {
    const json = await req.json();
    const data = schema.parse(json);
  const result = await generatePost(data);
    const postsDir = path.join(process.cwd(), 'content', 'posts');
    await mkdir(postsDir, { recursive: true });
    const filePath = path.join(postsDir, `${result.slug}.md`);
    await writeFile(filePath, result.markdown, 'utf8');
    return NextResponse.json({ ok: true, slug: result.slug, title: result.title, filePath });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Unknown error';
    return NextResponse.json({ ok: false, error: msg }, { status: 400 });
  }
}
