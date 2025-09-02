import { NextRequest, NextResponse } from 'next/server';
import { readFile } from 'fs/promises';
import path from 'path';
import { logger } from '@/lib/utils/logger';
import { validateInput, slugSchema } from '@/lib/utils/validation';
import { AppError } from '@/lib/utils/errors';

export async function GET(_req: NextRequest, context: { params: Promise<{ slug: string }> }) {
  const requestId = Math.random().toString(36).substr(2, 9);
  
  try {
    const { slug } = await context.params;
    
    logger.info('Post request started', { 
      component: 'api/post', 
      requestId, 
      slug 
    });

    // Validate slug
    const validSlug = validateInput(slugSchema, slug, 'Invalid slug format');
    
    const filePath = path.join(process.cwd(), 'content', 'posts', `${validSlug}.md`);
    const md = await readFile(filePath, 'utf8');
    
    logger.info('Post served successfully', { 
      component: 'api/post', 
      requestId, 
      slug: validSlug,
      fileSize: md.length 
    });
    
    return new NextResponse(md, { 
      headers: { 
        'content-type': 'text/markdown; charset=utf-8',
        'cache-control': 'public, max-age=300' // Cache for 5 minutes
      } 
    });
  } catch (error) {
    if (error instanceof AppError) {
      logger.warn('Post request failed with app error', {
        component: 'api/post',
        requestId,
        error: error.message
      });
      return new NextResponse(error.message, { status: error.statusCode });
    }
    
    // File not found or other filesystem errors
    logger.warn('Post not found or filesystem error', {
      component: 'api/post',
      requestId,
      error: (error as Error).message
    });
    
    return new NextResponse('Post not found', { status: 404 });
  }
}
