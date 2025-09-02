import { NextRequest, NextResponse } from 'next/server';
import { createServices } from '@/lib/utils/database';
import { logger } from '@/lib/utils/logger';

const services = createServices();

// GET /api/analytics/performance?operation=&days=7
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const operation = searchParams.get('operation') || undefined;
    const days = parseInt(searchParams.get('days') || '7');
    
    const stats = await services.performance.getPerformanceStats(operation, days);
    
    return NextResponse.json({
      success: true,
      data: stats,
      filters: {
        operation,
        days
      }
    });
  } catch (error) {
    logger.error('Failed to get performance analytics', {
      component: 'api/analytics/performance',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
    
    return NextResponse.json(
      { success: false, error: 'Failed to get performance analytics' },
      { status: 500 }
    );
  }
}
