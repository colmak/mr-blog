/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars */
import { logger } from './logger';
import { PerformanceService } from './database';

// Performance monitoring utilities
export interface PerformanceMetrics {
  startTime: number;
  endTime?: number;
  duration?: number;
  operation: string;
  metadata?: Record<string, any>;
}

// Simple performance monitor
export class PerformanceMonitor {
  private metrics: Map<string, PerformanceMetrics> = new Map();
  private performanceService?: PerformanceService;

  constructor(performanceService?: PerformanceService) {
    this.performanceService = performanceService;
  }

  // Start timing an operation
  start(operationId: string, operation: string, metadata?: Record<string, any>): void {
    this.metrics.set(operationId, {
      startTime: performance.now(),
      operation,
      metadata,
    });

    logger.debug('Performance monitoring started', {
      component: 'performance',
      operationId,
      operation
    });
  }

  // End timing and record the result
  async end(operationId: string, status: 'success' | 'error' | 'timeout' = 'success'): Promise<number> {
    const metric = this.metrics.get(operationId);
    if (!metric) {
      logger.warn('Performance metric not found', {
        component: 'performance',
        operationId
      });
      return 0;
    }

    const endTime = performance.now();
    const duration = endTime - metric.startTime;
    
    metric.endTime = endTime;
    metric.duration = duration;

    // Log the performance metric
    logger.info('Performance metric recorded', {
      component: 'performance',
      operationId,
      operation: metric.operation,
      duration: Math.round(duration),
      status
    });

    // Store in database if service is available
    if (this.performanceService) {
      try {
        await this.performanceService.trackOperation(
          metric.operation,
          Math.round(duration),
          status,
          metric.metadata
        );
      } catch (error) {
        logger.error('Failed to store performance metric', {
          component: 'performance',
          operationId,
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    }

    // Clean up
    this.metrics.delete(operationId);

    return duration;
  }

  // Get current metrics
  getCurrentMetrics(): PerformanceMetrics[] {
    return Array.from(this.metrics.values());
  }
}

// Decorator for automatic performance monitoring
export function withPerformance(operation: string, monitor?: PerformanceMonitor) {
  return function <T extends (...args: any[]) => Promise<any>>(
    target: any,
    propertyName: string,
    descriptor: TypedPropertyDescriptor<T>
  ) {
    const method = descriptor.value!;

    descriptor.value = (async function (this: any, ...args: any[]) {
      const operationId = `${operation}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      const performanceMonitor = monitor || new PerformanceMonitor();
      
      performanceMonitor.start(operationId, operation, {
        arguments: args.length,
        className: target.constructor.name,
        methodName: propertyName
      });

      try {
        const result = await method.apply(this, args);
        await performanceMonitor.end(operationId, 'success');
        return result;
      } catch (error) {
        await performanceMonitor.end(operationId, 'error');
        throw error;
      }
    }) as T;
  };
}

// Function wrapper for performance monitoring
export function measureAsync<T>(
  operation: string,
  fn: () => Promise<T>,
  monitor?: PerformanceMonitor,
  metadata?: Record<string, any>
): Promise<T> {
  const operationId = `${operation}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  const performanceMonitor = monitor || new PerformanceMonitor();
  
  performanceMonitor.start(operationId, operation, metadata);

  return fn()
    .then(async (result) => {
      await performanceMonitor.end(operationId, 'success');
      return result;
    })
    .catch(async (error) => {
      await performanceMonitor.end(operationId, 'error');
      throw error;
    });
}

// Synchronous performance measurement
export function measureSync<T>(
  operation: string,
  fn: () => T,
  metadata?: Record<string, any>
): T {
  const startTime = performance.now();
  
  logger.debug('Sync performance monitoring started', {
    component: 'performance',
    operation
  });

  try {
    const result = fn();
    const duration = performance.now() - startTime;
    
    logger.info('Sync performance metric recorded', {
      component: 'performance',
      operation,
      duration: Math.round(duration),
      status: 'success'
    });

    return result;
  } catch (error) {
    const duration = performance.now() - startTime;
    
    logger.info('Sync performance metric recorded', {
      component: 'performance',
      operation,
      duration: Math.round(duration),
      status: 'error'
    });

    throw error;
  }
}

// Web Vitals monitoring for client-side
export interface WebVitals {
  CLS?: number; // Cumulative Layout Shift
  FID?: number; // First Input Delay
  FCP?: number; // First Contentful Paint
  LCP?: number; // Largest Contentful Paint
  TTFB?: number; // Time to First Byte
}

export function trackWebVitals(vitals: WebVitals): void {
  logger.info('Web vitals tracked', {
    component: 'performance',
    type: 'web-vitals',
    ...vitals
  });

  // Send to analytics endpoint
  if (typeof window !== 'undefined') {
    fetch('/api/analytics/web-vitals', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        ...vitals,
        url: window.location.href,
        userAgent: navigator.userAgent,
        timestamp: Date.now(),
      }),
    }).catch((error) => {
      logger.error('Failed to send web vitals', {
        component: 'performance',
        error: error.message
      });
    });
  }
}

// Performance budget monitoring
export interface PerformanceBudget {
  operation: string;
  warningThreshold: number; // milliseconds
  errorThreshold: number; // milliseconds
}

export class PerformanceBudgetMonitor {
  private budgets: Map<string, PerformanceBudget> = new Map();

  addBudget(budget: PerformanceBudget): void {
    this.budgets.set(budget.operation, budget);
  }

  checkBudget(operation: string, duration: number): 'pass' | 'warning' | 'error' {
    const budget = this.budgets.get(operation);
    if (!budget) return 'pass';

    if (duration > budget.errorThreshold) {
      logger.warn('Performance budget exceeded (ERROR)', {
        component: 'performance',
        operation,
        duration,
        threshold: budget.errorThreshold,
        level: 'error'
      });
      return 'error';
    }

    if (duration > budget.warningThreshold) {
      logger.warn('Performance budget exceeded (WARNING)', {
        component: 'performance',
        operation,
        duration,
        threshold: budget.warningThreshold,
        level: 'warning'
      });
      return 'warning';
    }

    return 'pass';
  }

  getBudgets(): PerformanceBudget[] {
    return Array.from(this.budgets.values());
  }
}

// Default performance budgets for the blog application
export const defaultPerformanceBudgets: PerformanceBudget[] = [
  { operation: 'post_generation', warningThreshold: 30000, errorThreshold: 60000 }, // 30s warning, 60s error
  { operation: 'web_scraping', warningThreshold: 10000, errorThreshold: 30000 },     // 10s warning, 30s error
  { operation: 'analysis', warningThreshold: 5000, errorThreshold: 15000 },          // 5s warning, 15s error
  { operation: 'strategy', warningThreshold: 5000, errorThreshold: 15000 },          // 5s warning, 15s error
  { operation: 'page_render', warningThreshold: 1000, errorThreshold: 3000 },        // 1s warning, 3s error
  { operation: 'api_request', warningThreshold: 2000, errorThreshold: 5000 },        // 2s warning, 5s error
];

// Global performance monitor instance
let globalPerformanceMonitor: PerformanceMonitor;
let globalBudgetMonitor: PerformanceBudgetMonitor;

export function initializePerformanceMonitoring(performanceService?: PerformanceService): void {
  globalPerformanceMonitor = new PerformanceMonitor(performanceService);
  globalBudgetMonitor = new PerformanceBudgetMonitor();
  
  // Add default budgets
  defaultPerformanceBudgets.forEach(budget => {
    globalBudgetMonitor.addBudget(budget);
  });

  logger.info('Performance monitoring initialized', {
    component: 'performance',
    budgetsCount: defaultPerformanceBudgets.length
  });
}

export function getGlobalPerformanceMonitor(): PerformanceMonitor {
  if (!globalPerformanceMonitor) {
    globalPerformanceMonitor = new PerformanceMonitor();
  }
  return globalPerformanceMonitor;
}

export function getGlobalBudgetMonitor(): PerformanceBudgetMonitor {
  if (!globalBudgetMonitor) {
    globalBudgetMonitor = new PerformanceBudgetMonitor();
    defaultPerformanceBudgets.forEach(budget => {
      globalBudgetMonitor.addBudget(budget);
    });
  }
  return globalBudgetMonitor;
}
