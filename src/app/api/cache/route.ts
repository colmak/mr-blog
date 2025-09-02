import { NextRequest, NextResponse } from 'next/server';
import { initializeCache, MultiTierCache } from '@/lib/utils/cache';
import { logger } from '@/lib/utils/logger';
import { clearCache } from '@/lib/orchestrator';

let cache: MultiTierCache;

async function ensureCache() {
  if (!cache) {
    cache = await initializeCache();
  }
}

// GET /api/cache/stats - Get cache statistics
export async function GET() {
  try {
    await ensureCache();
    const stats = cache.getStats();
    
    return NextResponse.json({
      success: true,
      data: stats,
    });
  } catch (error) {
    logger.error('Failed to get cache stats', {
      component: 'api/cache',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
    
    return NextResponse.json(
      { success: false, error: 'Failed to get cache statistics' },
      { status: 500 }
    );
  }
}

// DELETE /api/cache - Clear cache
export async function DELETE(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const type = searchParams.get('type') as 'research' | 'analysis' | 'all' || 'all';
    
    await clearCache(type);
    
    logger.info('Cache cleared via API', {
      component: 'api/cache',
      type
    });
    
    return NextResponse.json({
      success: true,
      message: `Cache cleared: ${type}`,
    });
  } catch (error) {
    logger.error('Failed to clear cache', {
      component: 'api/cache',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
    
    return NextResponse.json(
      { success: false, error: 'Failed to clear cache' },
      { status: 500 }
    );
  }
}
