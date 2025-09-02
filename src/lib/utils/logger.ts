export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogContext {
  userId?: string;
  requestId?: string;
  component?: string;
  action?: string;
  metadata?: Record<string, unknown>;
  [key: string]: unknown; // Allow additional properties
}

class Logger {
  private isDev = process.env.NODE_ENV === 'development';

  private log(level: LogLevel, message: string, context?: LogContext, error?: Error) {
    const timestamp = new Date().toISOString();
    const logData = {
      timestamp,
      level,
      message,
      ...context,
      ...(error && { 
        error: {
          name: error.name,
          message: error.message,
          stack: error.stack,
        }
      })
    };

    if (this.isDev) {
      const consoleMethod = level === 'error' ? console.error : 
                           level === 'warn' ? console.warn : 
                           level === 'info' ? console.info : console.log;
      consoleMethod(`[${level.toUpperCase()}]`, message, context || '', error || '');
    } else {
      // In production, you could send to external service (Sentry, LogRocket, etc.)
      console.log(JSON.stringify(logData));
    }
  }

  debug(message: string, context?: LogContext) {
    this.log('debug', message, context);
  }

  info(message: string, context?: LogContext) {
    this.log('info', message, context);
  }

  warn(message: string, context?: LogContext, error?: Error) {
    this.log('warn', message, context, error);
  }

  error(message: string, context?: LogContext, error?: Error) {
    this.log('error', message, context, error);
  }
}

export const logger = new Logger();

// Error tracking helper
export function trackError(error: Error, context?: LogContext) {
  logger.error(error.message, context, error);
  
  // In production, send to error tracking service
  if (process.env.NODE_ENV === 'production' && typeof window !== 'undefined') {
    // Example: Sentry.captureException(error, { contexts: context });
  }
}
