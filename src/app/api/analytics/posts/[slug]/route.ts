import { NextRequest, NextResponse } from 'next/server';
import { createServices } from '@/lib/utils/database';
import { logger } from '@/lib/utils/logger';

const services = createServices();

// GET /api/analytics/posts/[slug]?days=30
export async function GET(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await params;
    const { searchParams } = new URL(req.url);
    const days = parseInt(searchParams.get('days') || '30');
    
    const analytics = await services.posts.getPostAnalytics(slug, days);
    
    return NextResponse.json({
      success: true,
      data: analytics,
      filters: {
        slug,
        days
      }
    });
  } catch (error) {
    logger.error('Failed to get post analytics', {
      component: 'api/analytics/posts',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
    
    return NextResponse.json(
      { success: false, error: 'Failed to get post analytics' },
      { status: 500 }
    );
  }
}
