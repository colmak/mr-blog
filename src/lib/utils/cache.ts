import { LRUCache } from 'lru-cache';
import { PrismaClient } from '@prisma/client';
import { logger } from './logger';
import { CacheStats } from '../types/common';

// Types
export interface CacheOptions {
  ttl?: number; // Time to live in milliseconds
  tags?: string[]; // Cache tags for invalidation
}

// In-memory cache for frequently accessed data
const memoryCache = new LRUCache<string, string>({
  max: 1000, // Maximum number of items
  ttl: 1000 * 60 * 15, // 15 minutes default TTL
  allowStale: true,
  updateAgeOnGet: true,
  updateAgeOnHas: true,
});

// Redis cache (optional, falls back to memory cache)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let redisClient: any = null;

// Cache statistics
const stats = {
  hits: 0,
  misses: 0,
  sets: 0,
  deletes: 0,
};

// Initialize Redis connection (optional)
export async function initializeRedis(): Promise<void> {
  try {
    if (process.env.REDIS_URL) {
      const { createClient } = await import('redis');
      redisClient = createClient({
        url: process.env.REDIS_URL,
      });
      
      redisClient.on('error', (err: Error) => {
        logger.warn('Redis connection error, falling back to memory cache', { 
          component: 'cache',
          error: err.message 
        });
        redisClient = null;
      });
      
      await redisClient.connect();
      logger.info('Redis cache connected successfully', { component: 'cache' });
    }
  } catch (error) {
    logger.warn('Redis not available, using memory cache only', { 
      component: 'cache',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}

// Database cache operations (for persistent cache)
export class DatabaseCache {
  constructor(private prisma: PrismaClient) {}

  async get<T>(key: string): Promise<T | null> {
    try {
      const cached = await this.prisma.cache.findUnique({
        where: { key },
      });

      if (!cached) {
        stats.misses++;
        return null;
      }

      // Check if expired
      if (cached.expiresAt && cached.expiresAt < new Date()) {
        await this.delete(key);
        stats.misses++;
        return null;
      }

      stats.hits++;
      return JSON.parse(cached.value);
    } catch (error) {
      logger.error('Database cache get error', { 
        component: 'cache',
        key,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      return null;
    }
  }

  async set<T>(key: string, value: T, options: CacheOptions = {}): Promise<void> {
    try {
      const expiresAt = options.ttl ? new Date(Date.now() + options.ttl) : null;
      
      await this.prisma.cache.upsert({
        where: { key },
        update: {
          value: JSON.stringify(value),
          tags: options.tags?.join(','),
          expiresAt,
        },
        create: {
          key,
          value: JSON.stringify(value),
          tags: options.tags?.join(','),
          expiresAt,
        },
      });

      stats.sets++;
    } catch (error) {
      logger.error('Database cache set error', { 
        component: 'cache',
        key,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  async delete(key: string): Promise<void> {
    try {
      await this.prisma.cache.delete({
        where: { key },
      });
      stats.deletes++;
    } catch (error) {
      logger.error('Database cache delete error', { 
        component: 'cache',
        key,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  async invalidateByTags(tags: string[]): Promise<void> {
    try {
      for (const tag of tags) {
        await this.prisma.cache.deleteMany({
          where: {
            tags: {
              contains: tag,
            },
          },
        });
      }
      logger.info('Cache invalidated by tags', { component: 'cache', tags });
    } catch (error) {
      logger.error('Cache invalidation error', { 
        component: 'cache',
        tags,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  async cleanup(): Promise<void> {
    try {
      const count = await this.prisma.cache.deleteMany({
        where: {
          expiresAt: {
            lte: new Date(),
          },
        },
      });
      logger.info('Expired cache entries cleaned up', { 
        component: 'cache',
        deletedCount: count.count 
      });
    } catch (error) {
      logger.error('Cache cleanup error', { 
        component: 'cache',
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }
}

// Multi-tier cache (Memory -> Redis -> Database)
export class MultiTierCache {
  constructor(private dbCache?: DatabaseCache) {}

  async get<T>(key: string): Promise<T | null> {
    // Try memory cache first
    if (memoryCache.has(key)) {
      stats.hits++;
      const cached = memoryCache.get(key);
      return cached ? JSON.parse(cached) : null;
    }

    // Try Redis cache
    if (redisClient) {
      try {
        const cached = await redisClient.get(key);
        if (cached) {
          const value = JSON.parse(cached);
          // Store in memory cache for next time
          memoryCache.set(key, cached);
          stats.hits++;
          return value;
        }
      } catch (error) {
        logger.warn('Redis cache get error', { 
          component: 'cache',
          key,
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    }

    // Try database cache
    if (this.dbCache) {
      const value = await this.dbCache.get<T>(key);
      if (value !== null) {
        // Store in higher-tier caches
        const serialized = JSON.stringify(value);
        memoryCache.set(key, serialized);
        if (redisClient) {
          try {
            await redisClient.setEx(key, 900, serialized); // 15 minutes
          } catch {
            logger.warn('Redis cache set error', { component: 'cache', key });
          }
        }
        return value;
      }
    }

    stats.misses++;
    return null;
  }

  async set<T>(key: string, value: T, options: CacheOptions = {}): Promise<void> {
    const ttl = options.ttl || 900000; // 15 minutes default
    const serialized = JSON.stringify(value);

    // Set in memory cache
    memoryCache.set(key, serialized, { ttl });

    // Set in Redis cache
    if (redisClient) {
      try {
        await redisClient.setEx(key, Math.floor(ttl / 1000), serialized);
      } catch {
        logger.warn('Redis cache set error', { component: 'cache', key });
      }
    }

    // Set in database cache
    if (this.dbCache) {
      await this.dbCache.set(key, value, options);
    }

    stats.sets++;
  }

  async delete(key: string): Promise<void> {
    // Delete from memory cache
    memoryCache.delete(key);

    // Delete from Redis cache
    if (redisClient) {
      try {
        await redisClient.del(key);
      } catch {
        logger.warn('Redis cache delete error', { component: 'cache', key });
      }
    }

    // Delete from database cache
    if (this.dbCache) {
      await this.dbCache.delete(key);
    }

    stats.deletes++;
  }

  async invalidateByTags(tags: string[]): Promise<void> {
    // Clear entire memory cache (simple approach)
    memoryCache.clear();

    // Clear Redis cache by pattern (if available)
    if (redisClient) {
      try {
        // This is a simplified approach - in production you might want more sophisticated tag-based invalidation
        await redisClient.flushDb();
      } catch {
        logger.warn('Redis cache flush error', { component: 'cache' });
      }
    }

    // Use database cache tag-based invalidation
    if (this.dbCache) {
      await this.dbCache.invalidateByTags(tags);
    }
  }

  getStats(): CacheStats {
    const total = stats.hits + stats.misses;
    return {
      ...stats,
      hitRate: total > 0 ? stats.hits / total : 0,
    };
  }
}

// Cache key generators
export const CacheKeys = {
  post: (slug: string) => `post:${slug}`,
  postContent: (slug: string) => `post:content:${slug}`,
  postHtml: (slug: string) => `post:html:${slug}`,
  postList: (page: number, limit: number) => `posts:list:${page}:${limit}`,
  postSearch: (query: string) => `posts:search:${encodeURIComponent(query)}`,
  research: (query: string) => `research:${encodeURIComponent(query)}`,
  researchSources: (query: string) => `research:sources:${encodeURIComponent(query)}`,
  analysis: (sourcesHash: string) => `analysis:${sourcesHash}`,
  tagList: () => 'tags:list',
  postsByTag: (tagSlug: string) => `posts:tag:${tagSlug}`,
};

// Cache tags for invalidation
export const CacheTags = {
  POSTS: 'posts',
  POST: 'post',
  TAGS: 'tags', 
  RESEARCH: 'research',
  ANALYSIS: 'analysis',
};

// Initialize cache on startup
export async function initializeCache(): Promise<MultiTierCache> {
  await initializeRedis();
  return new MultiTierCache();
}
