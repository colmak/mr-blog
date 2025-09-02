import { runResearch } from './agents/researcher';
import { runAnalysis } from './agents/analyst';
import { runStrategy } from './agents/strategist';
import { ResearchInput, StrategyOutput } from './agents/types';
import { logger } from './utils/logger';
import { measureAsync, getGlobalPerformanceMonitor } from './utils/performance';
import { MultiTierCache, CacheKeys } from './utils/cache';
import { createServices } from './utils/database';

export type OrchestratorInput = {
  topic: string;
  targetQuestions: string[];
  maxSources?: number;
  audience?: string;
  tone?: string;
  useLLM?: boolean;
  model?: string;
};

// Initialize cache and services
let cache: MultiTierCache;
let services: ReturnType<typeof createServices>;

export async function initializeOrchestrator(cacheInstance?: MultiTierCache): Promise<void> {
  if (cacheInstance) {
    cache = cacheInstance;
    services = createServices(cache);
  }
  
  logger.info('Orchestrator initialized with caching', { 
    component: 'orchestrator',
    cacheEnabled: !!cache 
  });
}

export async function generatePost(input: OrchestratorInput): Promise<StrategyOutput & {
  metadata: {
    generationTime: number;
    cacheHits: string[];
    cacheMisses: string[];
  }
}> {
  const startTime = Date.now();
  const performanceMonitor = getGlobalPerformanceMonitor();
  const operationId = `post_generation_${Date.now()}`;
  
  const metadata = {
    generationTime: 0,
    cacheHits: [] as string[],
    cacheMisses: [] as string[],
  };

  logger.info('Starting post generation', {
    component: 'orchestrator',
    topic: input.topic,
    targetQuestions: input.targetQuestions.length,
    maxSources: input.maxSources,
    useLLM: input.useLLM,
    model: input.model
  });

  performanceMonitor.start(operationId, 'post_generation', {
    topic: input.topic,
    targetQuestions: input.targetQuestions.length,
    useLLM: input.useLLM
  });

  try {
    // Step 1: Research with caching
    const research = await measureAsync(
      'research_phase',
      async () => {
        const researchInput: ResearchInput = { 
          topic: input.topic, 
          maxSources: input.maxSources ?? 6 
        };
        
        // Check research cache
        if (cache && services) {
          const cachedResearch = await services.research.getCachedResearch(input.topic);
          if (cachedResearch) {
            metadata.cacheHits.push('research');
            logger.info('Using cached research results', {
              component: 'orchestrator',
              topic: input.topic,
              sourcesCount: cachedResearch.sources?.length || 0
            });
            return cachedResearch;
          }
          metadata.cacheMisses.push('research');
        }

        // Perform fresh research
        const freshResearch = await runResearch(researchInput);
        
        // Cache the results
        if (cache && services) {
          await services.research.cacheResearch(
            input.topic,
            freshResearch,
            freshResearch.sources || []
          );
        }

        return freshResearch;
      },
      performanceMonitor,
      { phase: 'research', topic: input.topic }
    );

    // Step 2: Analysis with caching
    const analysis = await measureAsync(
      'analysis_phase',
      async () => {
        // Create a hash of the sources for cache key
        const sourcesHash = Buffer.from(
          JSON.stringify(research.sources?.map((s: { url: string }) => s.url).sort())
        ).toString('base64').slice(0, 16);
        
        const cacheKey = CacheKeys.analysis(sourcesHash);
        
        // Check analysis cache
        if (cache) {
          const cachedAnalysis = await cache.get(cacheKey);
          if (cachedAnalysis) {
            metadata.cacheHits.push('analysis');
            logger.info('Using cached analysis results', {
              component: 'orchestrator',
              sourcesHash
            });
            return cachedAnalysis;
          }
          metadata.cacheMisses.push('analysis');
        }

        // Perform fresh analysis
        const freshAnalysis = await runAnalysis({
          sources: research.sources,
          useLLM: input.useLLM,
          model: input.model,
        });

        // Cache the results
        if (cache) {
          await cache.set(cacheKey, freshAnalysis, {
            ttl: 1000 * 60 * 60 * 12, // 12 hours
            tags: ['analysis']
          });
        }

        return freshAnalysis;
      },
      performanceMonitor,
      { phase: 'analysis', sourcesCount: research.sources?.length || 0 }
    );

    // Step 3: Strategy (content generation)
    const strategy = await measureAsync(
      'strategy_phase',
      async () => {
        return await runStrategy({
          topic: input.topic,
          targetQuestions: input.targetQuestions,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          analyzed: (analysis as any).analyzed || analysis || [],
          audience: input.audience,
          tone: input.tone,
          useLLM: input.useLLM,
          model: input.model,
        });
      },
      performanceMonitor,
      { 
        phase: 'strategy', 
        topic: input.topic,
        questionsCount: input.targetQuestions.length 
      }
    );

    // Calculate total generation time
    metadata.generationTime = Date.now() - startTime;

    // Store the post in database if services are available
    if (services) {
      try {
        await services.posts.createPost({
          title: strategy.title,
          slug: strategy.slug,
          content: strategy.markdown,
          topic: input.topic,
          targetQuestions: input.targetQuestions,
          sources: research.sources || [],
          excerpt: strategy.excerpt,
          readingTime: strategy.readingTime,
          wordCount: strategy.wordCount,
          generationTime: metadata.generationTime,
          model: input.model,
        });

        logger.info('Post saved to database', {
          component: 'orchestrator',
          slug: strategy.slug,
          title: strategy.title
        });
      } catch (error) {
        logger.error('Failed to save post to database', {
          component: 'orchestrator',
          slug: strategy.slug,
          error: error instanceof Error ? error.message : 'Unknown error'
        });
        // Continue execution - database save failure shouldn't break generation
      }
    }

    await performanceMonitor.end(operationId, 'success');

    logger.info('Post generation completed successfully', {
      component: 'orchestrator',
      topic: input.topic,
      slug: strategy.slug,
      generationTime: metadata.generationTime,
      cacheHits: metadata.cacheHits.length,
      cacheMisses: metadata.cacheMisses.length
    });

    return {
      ...strategy,
      metadata,
    };

  } catch (error) {
    await performanceMonitor.end(operationId, 'error');
    
    logger.error('Post generation failed', {
      component: 'orchestrator',
      topic: input.topic,
      error: error instanceof Error ? error.message : 'Unknown error',
      generationTime: Date.now() - startTime
    });

    throw error;
  }
}

// Get cached research for preview/debugging
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function getCachedResearch(topic: string): Promise<any | null> {
  if (!cache || !services) {
    return null;
  }
  
  return await services.research.getCachedResearch(topic);
}

// Clear specific caches
export async function clearCache(type: 'research' | 'analysis' | 'all' = 'all'): Promise<void> {
  if (!cache) {
    logger.warn('Cache not available for clearing', { component: 'orchestrator' });
    return;
  }

  try {
    if (type === 'all') {
      await cache.invalidateByTags(['research', 'analysis']);
    } else {
      await cache.invalidateByTags([type]);
    }

    logger.info('Cache cleared successfully', {
      component: 'orchestrator',
      type
    });
  } catch (error) {
    logger.error('Failed to clear cache', {
      component: 'orchestrator',
      type,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}
