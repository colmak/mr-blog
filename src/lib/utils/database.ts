/* eslint-disable @typescript-eslint/no-explicit-any */
import { PrismaClient, Post, PostStatus } from '@prisma/client';
import { logger } from './logger';
import { MultiTierCache, CacheKeys, CacheTags } from './cache';

// Singleton Prisma client
let prisma: PrismaClient;

declare global {
  var __prisma: PrismaClient | undefined;
}

if (process.env.NODE_ENV === 'production') {
  prisma = new PrismaClient();
} else {
  if (!global.__prisma) {
    global.__prisma = new PrismaClient({
      log: ['query', 'error', 'warn'],
    });
  }
  prisma = global.__prisma;
}

export { prisma };

// Post-related database operations
export class PostService {
  constructor(private cache?: MultiTierCache) {}

  // Create a new post
  async createPost(data: {
    title: string;
    slug: string;
    content: string;
    topic: string;
    targetQuestions: string[];
    sources: any[];
    excerpt?: string;
    readingTime?: number;
    wordCount?: number;
    generationTime?: number;
    model?: string;
  }): Promise<Post> {
    try {
      const post = await prisma.post.create({
        data: {
          ...data,
          targetQuestions: JSON.stringify(data.targetQuestions),
          sources: JSON.stringify(data.sources),
          status: PostStatus.DRAFT,
        },
      });

      // Invalidate related caches
      await this.cache?.invalidateByTags([CacheTags.POSTS]);
      
      logger.info('Post created successfully', { 
        component: 'database',
        operation: 'createPost',
        postId: post.id,
        slug: post.slug
      });

      return post;
    } catch (error) {
      logger.error('Failed to create post', {
        component: 'database',
        operation: 'createPost',
        error: error instanceof Error ? error.message : 'Unknown error',
        slug: data.slug
      });
      throw error;
    }
  }

  // Get post by slug with caching
  async getPostBySlug(slug: string, includeUnpublished = false): Promise<Post | null> {
    const cacheKey = CacheKeys.post(slug);
    
    // Try cache first
    const cached = await this.cache?.get<Post>(cacheKey);
    if (cached && (includeUnpublished || cached.status === PostStatus.PUBLISHED)) {
      return cached;
    }

    try {
      const post = await prisma.post.findUnique({
        where: { slug },
        include: {
          tags: {
            include: {
              tag: true,
            },
          },
        },
      });

      if (!post) {
        return null;
      }

      if (!includeUnpublished && post.status !== PostStatus.PUBLISHED) {
        return null;
      }

      // Cache the result
      await this.cache?.set(cacheKey, post, {
        ttl: 1000 * 60 * 30, // 30 minutes
        tags: [CacheTags.POST, CacheTags.POSTS],
      });

      return post;
    } catch (error) {
      logger.error('Failed to get post by slug', {
        component: 'database',
        operation: 'getPostBySlug',
        slug,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }

  // Get posts list with pagination and caching
  async getPosts(options: {
    page?: number;
    limit?: number;
    status?: PostStatus;
    tag?: string;
  } = {}): Promise<{
    posts: Post[];
    total: number;
    totalPages: number;
    currentPage: number;
  }> {
    const page = options.page || 1;
    const limit = options.limit || 10;
    const status = options.status || PostStatus.PUBLISHED;
    
    const cacheKey = CacheKeys.postList(page, limit);
    
    // Try cache first
    const cached = await this.cache?.get<any>(cacheKey);
    if (cached) {
      return cached;
    }

    try {
      const where: any = { status };
      if (options.tag) {
        where.tags = {
          some: {
            tag: {
              slug: options.tag,
            },
          },
        };
      }

      const [posts, total] = await Promise.all([
        prisma.post.findMany({
          where,
          include: {
            tags: {
              include: {
                tag: true,
              },
            },
          },
          orderBy: {
            publishedAt: 'desc',
          },
          skip: (page - 1) * limit,
          take: limit,
        }),
        prisma.post.count({ where }),
      ]);

      const result = {
        posts,
        total,
        totalPages: Math.ceil(total / limit),
        currentPage: page,
      };

      // Cache the result
      await this.cache?.set(cacheKey, result, {
        ttl: 1000 * 60 * 15, // 15 minutes
        tags: [CacheTags.POSTS],
      });

      return result;
    } catch (error) {
      logger.error('Failed to get posts list', {
        component: 'database',
        operation: 'getPosts',
        page,
        limit,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }

  // Publish a post
  async publishPost(slug: string): Promise<Post | null> {
    try {
      const post = await prisma.post.update({
        where: { slug },
        data: {
          status: PostStatus.PUBLISHED,
          publishedAt: new Date(),
        },
      });

      // Invalidate caches
      await this.cache?.delete(CacheKeys.post(slug));
      await this.cache?.invalidateByTags([CacheTags.POSTS]);

      logger.info('Post published successfully', {
        component: 'database',
        operation: 'publishPost',
        slug
      });

      return post;
    } catch (error) {
      logger.error('Failed to publish post', {
        component: 'database',
        operation: 'publishPost',
        slug,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }

  // Track post view for analytics
  async trackPostView(postId: string, metadata: {
    userAgent?: string;
    ip?: string;
    country?: string;
    referer?: string;
    loadTime?: number;
  }): Promise<void> {
    try {
      await prisma.postView.create({
        data: {
          postId,
          ...metadata,
        },
      });

      logger.debug('Post view tracked', {
        component: 'database',
        operation: 'trackPostView',
        postId
      });
    } catch (error) {
      logger.error('Failed to track post view', {
        component: 'database',
        operation: 'trackPostView',
        postId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      // Don't throw - view tracking shouldn't break the app
    }
  }

  // Get post analytics
  async getPostAnalytics(slug: string, days = 30): Promise<{
    totalViews: number;
    uniqueViews: number;
    avgLoadTime: number;
    topCountries: { country: string; count: number }[];
    viewsOverTime: { date: string; views: number }[];
  }> {
    try {
      const post = await prisma.post.findUnique({
        where: { slug },
        select: { id: true },
      });

      if (!post) {
        throw new Error('Post not found');
      }

      const sinceDate = new Date();
      sinceDate.setDate(sinceDate.getDate() - days);

      const views = await prisma.postView.findMany({
        where: {
          postId: post.id,
          viewedAt: {
            gte: sinceDate,
          },
        },
      });

      const totalViews = views.length;
      const uniqueViews = new Set(views.map(v => v.ip)).size;
      const avgLoadTime = views.reduce((sum, v) => sum + (v.loadTime || 0), 0) / totalViews || 0;

      // Group by country
      const countryMap = new Map<string, number>();
      views.forEach(v => {
        if (v.country) {
          countryMap.set(v.country, (countryMap.get(v.country) || 0) + 1);
        }
      });
      const topCountries = Array.from(countryMap.entries())
        .map(([country, count]) => ({ country, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 10);

      // Group by date
      const dateMap = new Map<string, number>();
      views.forEach(v => {
        const date = v.viewedAt.toISOString().split('T')[0];
        dateMap.set(date, (dateMap.get(date) || 0) + 1);
      });
      const viewsOverTime = Array.from(dateMap.entries())
        .map(([date, views]) => ({ date, views }))
        .sort((a, b) => a.date.localeCompare(b.date));

      return {
        totalViews,
        uniqueViews,
        avgLoadTime,
        topCountries,
        viewsOverTime,
      };
    } catch (error) {
      logger.error('Failed to get post analytics', {
        component: 'database',
        operation: 'getPostAnalytics',
        slug,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }
}

// Research cache service
export class ResearchService {
  constructor(private cache?: MultiTierCache) {}

  async getCachedResearch(query: string): Promise<any | null> {
    const cacheKey = CacheKeys.research(query);
    return await this.cache?.get(cacheKey);
  }

  async cacheResearch(query: string, results: any, sources: any[]): Promise<void> {
    try {
      // Cache in multi-tier cache
      const cacheKey = CacheKeys.research(query);
      await this.cache?.set(cacheKey, results, {
        ttl: 1000 * 60 * 60 * 24, // 24 hours
        tags: [CacheTags.RESEARCH],
      });

      // Store in database for persistence
      await prisma.researchCache.upsert({
        where: { query },
        update: {
          results: JSON.stringify(results),
          sources: JSON.stringify(sources),
          sourcesCount: sources.length,
          totalWords: this.calculateTotalWords(results),
        },
        create: {
          query,
          results: JSON.stringify(results),
          sources: JSON.stringify(sources),
          sourcesCount: sources.length,
          totalWords: this.calculateTotalWords(results),
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24 hours
        },
      });

      logger.info('Research cached successfully', {
        component: 'database',
        operation: 'cacheResearch',
        query,
        sourcesCount: sources.length
      });
    } catch (error) {
      logger.error('Failed to cache research', {
        component: 'database',
        operation: 'cacheResearch',
        query,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  private calculateTotalWords(results: any): number {
    if (!results?.sources) return 0;
    return results.sources.reduce((total: number, source: any) => {
      return total + (source.content?.split(' ').length || 0);
    }, 0);
  }
}

// Performance monitoring service
export class PerformanceService {
  async trackOperation(operation: string, duration: number, status: string, metadata?: any): Promise<void> {
    try {
      await prisma.performanceMetric.create({
        data: {
          operation,
          duration,
          status,
          metadata: metadata ? JSON.stringify(metadata) : null,
        },
      });

      logger.debug('Performance metric tracked', {
        component: 'database',
        operation: 'trackOperation',
        metricOperation: operation,
        duration,
        status
      });
    } catch (error) {
      logger.error('Failed to track performance metric', {
        component: 'database',
        operation: 'trackOperation',
        metricOperation: operation,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  async getPerformanceStats(operation?: string, days = 7): Promise<{
    avgDuration: number;
    successRate: number;
    totalOperations: number;
    operationsOverTime: { date: string; count: number; avgDuration: number }[];
  }> {
    try {
      const sinceDate = new Date();
      sinceDate.setDate(sinceDate.getDate() - days);

      const where: any = {
        createdAt: {
          gte: sinceDate,
        },
      };

      if (operation) {
        where.operation = operation;
      }

      const metrics = await prisma.performanceMetric.findMany({
        where,
      });

      const totalOperations = metrics.length;
      const successfulOperations = metrics.filter(m => m.status === 'success').length;
      const avgDuration = metrics.reduce((sum, m) => sum + m.duration, 0) / totalOperations || 0;
      const successRate = successfulOperations / totalOperations || 0;

      // Group by date
      const dateMap = new Map<string, { count: number; totalDuration: number }>();
      metrics.forEach(m => {
        const date = m.createdAt.toISOString().split('T')[0];
        const current = dateMap.get(date) || { count: 0, totalDuration: 0 };
        dateMap.set(date, {
          count: current.count + 1,
          totalDuration: current.totalDuration + m.duration,
        });
      });

      const operationsOverTime = Array.from(dateMap.entries())
        .map(([date, data]) => ({
          date,
          count: data.count,
          avgDuration: data.totalDuration / data.count,
        }))
        .sort((a, b) => a.date.localeCompare(b.date));

      return {
        avgDuration,
        successRate,
        totalOperations,
        operationsOverTime,
      };
    } catch (error) {
      logger.error('Failed to get performance stats', {
        component: 'database',
        operation: 'getPerformanceStats',
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }
}

// Initialize services
export function createServices(cache?: MultiTierCache) {
  return {
    posts: new PostService(cache),
    research: new ResearchService(cache),
    performance: new PerformanceService(),
  };
}
