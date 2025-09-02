import { NextRequest, NextResponse } from 'next/server';
import { generatePost, initializeOrchestrator } from '@/lib/orchestrator';
import { writeFile, mkdir } from 'fs/promises';
import path from 'path';
import { logger, trackError } from '@/lib/utils/logger';
import { validateInput, generateRequestSchema, checkRateLimit } from '@/lib/utils/validation';
import { AppError, RateLimitError, getErrorMessage } from '@/lib/utils/errors';
import { initializeCache } from '@/lib/utils/cache';
import { initializePerformanceMonitoring, getGlobalPerformanceMonitor } from '@/lib/utils/performance';
import { createServices } from '@/lib/utils/database';

// Initialize cache and services on startup
let initialized = false;

async function ensureInitialized() {
  if (!initialized) {
    try {
      const cache = await initializeCache();
      const services = createServices(cache);
      initializePerformanceMonitoring(services.performance);
      await initializeOrchestrator(cache);
      initialized = true;
      logger.info('API initialized with caching and performance monitoring', { component: 'api/generate' });
    } catch (error) {
      logger.error('Failed to initialize API', { 
        component: 'api/generate',
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      // Continue without cache if initialization fails
      await initializeOrchestrator();
      initialized = true;
    }
  }
}

export async function POST(req: NextRequest) {
  await ensureInitialized();
  
  const startTime = Date.now();
  const requestId = Math.random().toString(36).substr(2, 9);
  const performanceMonitor = getGlobalPerformanceMonitor();
  const apiOperationId = `api_generate_${requestId}`;
  
  performanceMonitor.start(apiOperationId, 'api_request', {
    endpoint: '/api/generate',
    method: 'POST',
    requestId
  });
  
  try {
    logger.info('Generate post request started', { 
      component: 'api/generate', 
      requestId,
      userAgent: req.headers.get('user-agent')
    });

    // Rate limiting
    const clientIP = req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || 'unknown';
    if (!checkRateLimit(clientIP, 5, 60000)) { // 5 requests per minute
      logger.warn('Rate limit exceeded', { component: 'api/generate', clientIP, requestId });
      throw new RateLimitError('Too many requests. Please try again later.');
    }

    // Parse and validate request
    const json = await req.json();
    const data = validateInput(generateRequestSchema, json, 'Invalid request data');
    
    logger.info('Request validated successfully', { 
      component: 'api/generate', 
      requestId, 
      topic: data.topic,
      questionCount: data.targetQuestions.length,
      useLLM: data.useLLM
    });

    // Generate the post
    const result = await generatePost(data);
    
    // Save to file system
    const postsDir = path.join(process.cwd(), 'content', 'posts');
    await mkdir(postsDir, { recursive: true });
    const filePath = path.join(postsDir, `${result.slug}.md`);
    await writeFile(filePath, result.markdown, 'utf8');
    
    const duration = Date.now() - startTime;
    await performanceMonitor.end(apiOperationId, 'success');
    
    logger.info('Post generation completed successfully', {
      component: 'api/generate',
      requestId,
      slug: result.slug,
      duration,
      filePath,
      cacheHits: result.metadata?.cacheHits?.length || 0,
      cacheMisses: result.metadata?.cacheMisses?.length || 0
    });

    return NextResponse.json({ 
      ok: true, 
      slug: result.slug, 
      title: result.title, 
      filePath: `content/posts/${result.slug}.md`,
      duration,
      readingTime: result.readingTime,
      wordCount: result.wordCount,
      generationTime: result.metadata?.generationTime || duration,
      cacheStats: {
        hits: result.metadata?.cacheHits || [],
        misses: result.metadata?.cacheMisses || []
      }
    });
    
  } catch (error) {
    const duration = Date.now() - startTime;
    const errorMessage = getErrorMessage(error);
    await performanceMonitor.end(apiOperationId, 'error');
    
    logger.error('Post generation failed', {
      component: 'api/generate',
      requestId,
      duration,
      error: errorMessage
    }, error as Error);

    if (error instanceof AppError) {
      return NextResponse.json(
        { ok: false, error: error.message },
        { status: error.statusCode }
      );
    }

    // Track unexpected errors
    trackError(error as Error, { component: 'api/generate', requestId });
    
    return NextResponse.json(
      { ok: false, error: 'An unexpected error occurred. Please try again.' },
      { status: 500 }
    );
  }
}
