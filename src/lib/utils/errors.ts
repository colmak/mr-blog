export class AppError extends Error {
  public readonly isOperational: boolean;
  public readonly statusCode: number;
  public readonly context?: Record<string, unknown>;

  constructor(
    message: string,
    statusCode: number = 500,
    isOperational: boolean = true,
    context?: Record<string, unknown>
  ) {
    super(message);
    
    this.name = this.constructor.name;
    this.statusCode = statusCode;
    this.isOperational = isOperational;
    this.context = context;
    
    Error.captureStackTrace(this, this.constructor);
  }
}

export class ValidationError extends AppError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, 400, true, context);
  }
}

export class NetworkError extends AppError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, 500, true, context);
  }
}

export class ExternalServiceError extends AppError {
  public readonly service: string;
  
  constructor(service: string, message: string, context?: Record<string, unknown>) {
    super(`${service} error: ${message}`, 502, true, context);
    this.service = service;
  }
}

export class RateLimitError extends AppError {
  constructor(message: string = 'Rate limit exceeded') {
    super(message, 429, true);
  }
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}

export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === 'string') {
    return error;
  }
  return 'An unknown error occurred';
}

export function getErrorContext(error: unknown): Record<string, unknown> {
  if (isAppError(error)) {
    return {
      name: error.name,
      statusCode: error.statusCode,
      isOperational: error.isOperational,
      ...error.context
    };
  }
  if (error instanceof Error) {
    return {
      name: error.name,
      stack: error.stack
    };
  }
  return { error: String(error) };
}
