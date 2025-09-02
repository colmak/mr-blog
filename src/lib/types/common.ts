// Common types for the application

export interface CacheEntry {
  key: string;
  value: unknown;
  tags?: string[];
  expiresAt?: Date;
}

export interface PerformanceMetadata {
  [key: string]: unknown;
}

export interface WebVitalsData {
  CLS?: number;
  FID?: number;
  FCP?: number;
  LCP?: number;
  TTFB?: number;
  url?: string;
  userAgent?: string;
  timestamp?: number;
}

export interface PostAnalytics {
  totalViews: number;
  uniqueViews: number;
  avgLoadTime: number;
  topCountries: { country: string; count: number }[];
  viewsOverTime: { date: string; views: number }[];
}

export interface PerformanceStats {
  avgDuration: number;
  successRate: number;
  totalOperations: number;
  operationsOverTime: { date: string; count: number; avgDuration: number }[];
}

export interface CacheStats {
  hits: number;
  misses: number;
  sets: number;
  deletes: number;
  hitRate: number;
}
