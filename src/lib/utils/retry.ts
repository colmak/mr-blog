import { logger } from './logger';
import { NetworkError, getErrorMessage } from './errors';

interface RetryOptions {
  maxAttempts: number;
  delayMs: number;
  backoffMultiplier?: number;
  shouldRetry?: (error: unknown) => boolean;
}

const defaultRetryOptions: RetryOptions = {
  maxAttempts: 3,
  delayMs: 1000,
  backoffMultiplier: 2,
  shouldRetry: (error) => {
    if (error instanceof Error) {
      // Don't retry on client errors (4xx)
      if ('status' in error && typeof error.status === 'number') {
        return error.status >= 500;
      }
    }
    return true;
  }
};

export async function retryAsync<T>(
  fn: () => Promise<T>,
  options: Partial<RetryOptions> = {}
): Promise<T> {
  const opts = { ...defaultRetryOptions, ...options };
  let lastError: unknown;
  
  for (let attempt = 1; attempt <= opts.maxAttempts; attempt++) {
    try {
      const result = await fn();
      if (attempt > 1) {
        logger.info('Operation succeeded after retry', { attempt, maxAttempts: opts.maxAttempts });
      }
      return result;
    } catch (error) {
      lastError = error;
      
      logger.warn('Operation failed, considering retry', {
        attempt,
        maxAttempts: opts.maxAttempts,
        error: getErrorMessage(error)
      });
      
      // Don't retry if this is the last attempt
      if (attempt === opts.maxAttempts) {
        break;
      }
      
      // Don't retry if shouldRetry returns false
      if (!opts.shouldRetry?.(error)) {
        logger.info('Skipping retry due to shouldRetry condition', {
          error: getErrorMessage(error)
        });
        break;
      }
      
      // Calculate delay with backoff
      const delay = opts.delayMs * Math.pow(opts.backoffMultiplier || 2, attempt - 1);
      logger.debug('Waiting before retry', { delay, attempt });
      
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  
  logger.error('Operation failed after all retries', {
    maxAttempts: opts.maxAttempts,
    error: getErrorMessage(lastError)
  });
  
  throw lastError;
}

export async function fetchWithRetry(
  url: string,
  options: RequestInit = {},
  retryOptions: Partial<RetryOptions> = {}
): Promise<Response> {
  return retryAsync(async () => {
    try {
      const response = await fetch(url, {
        ...options,
        headers: {
          'User-Agent': 'mr-blog-bot/1.0',
          ...options.headers
        }
      });
      
      if (!response.ok) {
        throw new NetworkError(`HTTP ${response.status}: ${response.statusText}`, {
          url,
          status: response.status,
          statusText: response.statusText
        });
      }
      
      return response;
    } catch (error) {
      if (error instanceof TypeError && error.message.includes('fetch')) {
        throw new NetworkError(`Network error: ${error.message}`, { url });
      }
      throw error;
    }
  }, {
    shouldRetry: (error) => {
      // Don't retry on 4xx client errors, but retry on 5xx server errors and network issues
      if (error instanceof NetworkError && error.context?.status) {
        const status = error.context.status as number;
        return status >= 500 || status === 429; // Retry on server errors and rate limits
      }
      return true; // Retry on network errors
    },
    ...retryOptions
  });
}
