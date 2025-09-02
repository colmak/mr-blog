import { NextRequest, NextResponse } from 'next/server';
import { logger } from '@/lib/utils/logger';
import { trackWebVitals, WebVitals } from '@/lib/utils/performance';

// POST /api/analytics/web-vitals - Track web vitals from client
export async function POST(req: NextRequest) {
  try {
    const vitals: WebVitals & {
      url?: string;
      userAgent?: string;
      timestamp?: number;
    } = await req.json();
    
    // Track the web vitals
    trackWebVitals(vitals);
    
    // You could also store in database here for historical analysis
    logger.info('Web vitals received', {
      component: 'api/analytics/web-vitals',
      ...vitals
    });
    
    return NextResponse.json({
      success: true,
      message: 'Web vitals tracked',
    });
  } catch (error) {
    logger.error('Failed to track web vitals', {
      component: 'api/analytics/web-vitals',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
    
    return NextResponse.json(
      { success: false, error: 'Failed to track web vitals' },
      { status: 500 }
    );
  }
}
