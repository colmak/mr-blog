import { z } from 'zod';
import DOMPurify from 'isomorphic-dompurify';

// Common validation schemas
export const generateRequestSchema = z.object({
  topic: z.string()
    .min(3, 'Topic must be at least 3 characters')
    .max(200, 'Topic must be less than 200 characters')
    .regex(/^[a-zA-Z0-9\s\-_.,!?]+$/, 'Topic contains invalid characters'),
  
  targetQuestions: z.array(
    z.string()
      .min(5, 'Each question must be at least 5 characters')
      .max(500, 'Each question must be less than 500 characters')
  ).min(1, 'At least one question is required')
   .max(10, 'Maximum 10 questions allowed'),
  
  maxSources: z.number()
    .int('Max sources must be an integer')
    .min(3, 'Minimum 3 sources required')
    .max(10, 'Maximum 10 sources allowed')
    .optional(),
    
  audience: z.string()
    .max(100, 'Audience description too long')
    .optional(),
    
  tone: z.string()
    .max(100, 'Tone description too long') 
    .optional(),
    
  useLLM: z.boolean().optional(),
  
  model: z.string()
    .regex(/^[a-zA-Z0-9\-_.]+$/, 'Invalid model name')
    .optional()
});

export const slugSchema = z.string()
  .min(1, 'Slug is required')
  .max(200, 'Slug too long')
  .regex(/^[a-zA-Z0-9\-_]+$/, 'Slug contains invalid characters');

// Environment variables validation
export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).optional(),
  OPENAI_API_KEY: z.string().optional(),
  SERPAPI_API_KEY: z.string().optional(),
});

// Sanitization functions
export function sanitizeHtml(input: string): string {
  return DOMPurify.sanitize(input, {
    ALLOWED_TAGS: ['b', 'i', 'em', 'strong', 'code'],
    ALLOWED_ATTR: []
  });
}

export function sanitizeText(input: string): string {
  return input
    .replace(/[<>]/g, '') // Remove potential HTML
    .replace(/[\x00-\x1f\x7f-\x9f]/g, '') // Remove control characters
    .trim();
}

export function sanitizeUrl(url: string): string {
  try {
    const parsed = new URL(url);
    // Only allow http and https protocols
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      throw new Error('Invalid protocol');
    }
    return parsed.toString();
  } catch {
    throw new Error('Invalid URL format');
  }
}

// Validation helper function
export function validateInput<T>(
  schema: z.ZodSchema<T>,
  data: unknown,
  errorMessage: string = 'Validation failed'
): T {
  try {
    return schema.parse(data);
  } catch (error) {
    if (error instanceof z.ZodError) {
      const fieldErrors = error.issues.map((e: z.ZodIssue) => `${e.path.join('.')}: ${e.message}`);
      throw new Error(`${errorMessage}: ${fieldErrors.join(', ')}`);
    }
    throw new Error(errorMessage);
  }
}

// Rate limiting utilities
const requestCounts = new Map<string, { count: number; resetTime: number }>();

export function checkRateLimit(
  identifier: string, 
  maxRequests: number = 10, 
  windowMs: number = 60000 // 1 minute
): boolean {
  const now = Date.now();
  const key = identifier;
  
  const existing = requestCounts.get(key);
  
  if (!existing || now > existing.resetTime) {
    // Reset window
    requestCounts.set(key, { count: 1, resetTime: now + windowMs });
    return true;
  }
  
  if (existing.count >= maxRequests) {
    return false; // Rate limited
  }
  
  existing.count++;
  return true;
}

export function getRateLimitInfo(identifier: string): {
  remaining: number;
  resetTime: number;
} | null {
  const existing = requestCounts.get(identifier);
  if (!existing) {
    return null;
  }
  
  return {
    remaining: Math.max(0, 10 - existing.count),
    resetTime: existing.resetTime
  };
}
