import { NextRequest, NextResponse } from 'next/server';
import { readFile } from 'fs/promises';
import path from 'path';

export async function GET(_req: NextRequest, context: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await context.params;
    const filePath = path.join(process.cwd(), 'content', 'posts', `${slug}.md`);
    const md = await readFile(filePath, 'utf8');
    return new NextResponse(md, { headers: { 'content-type': 'text/markdown; charset=utf-8' } });
  } catch (_err: unknown) {
    return new NextResponse('Not found', { status: 404 });
  }
}
