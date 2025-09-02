import { NextRequest, NextResponse } from 'next/server';
import { createServices } from '@/lib/utils/database';
import { logger } from '@/lib/utils/logger';

const services = createServices();

// POST /api/analytics/track-view - Track post view
export async function POST(req: NextRequest) {
  try {
    const data = await req.json();
    const {
      postId,
      slug,
      userAgent,
      referer,
      loadTime,
    } = data;

    // Get client IP
    const clientIP = req.headers.get('x-forwarded-for') || 
                     req.headers.get('x-real-ip') || 
                     'unknown';

    // If we have a postId, track the view
    if (postId) {
      await services.posts.trackPostView(postId, {
        userAgent,
        ip: clientIP,
        referer,
        loadTime,
      });
    } else {
      // Log the view even if we don't have a post ID
      logger.info('Post view tracked (file-based)', {
        component: 'api/analytics/track-view',
        slug,
        userAgent,
        ip: clientIP,
        loadTime
      });
    }

    return NextResponse.json({
      success: true,
      message: 'View tracked',
    });
  } catch (error) {
    logger.error('Failed to track view', {
      component: 'api/analytics/track-view',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
    
    return NextResponse.json(
      { success: false, error: 'Failed to track view' },
      { status: 500 }
    );
  }
}
