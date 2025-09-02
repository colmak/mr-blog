'use client';

import React, { Component, ErrorInfo, ReactNode } from 'react';
import Link from 'next/link';
import { logger, trackError } from '../utils/logger';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
}

interface State {
  hasError: boolean;
  error?: Error;
  errorId?: string;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
  };

  public static getDerivedStateFromError(error: Error): State {
    return {
      hasError: true,
      error,
      errorId: Math.random().toString(36).substr(2, 9)
    };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    const errorId = this.state.errorId || 'unknown';
    
    logger.error('React Error Boundary caught error', {
      component: 'ErrorBoundary',
      errorId,
      componentStack: errorInfo.componentStack
    }, error);

    trackError(error, {
      component: 'ErrorBoundary', 
      errorId,
      componentStack: errorInfo.componentStack
    });

    this.props.onError?.(error, errorInfo);
  }

  private handleRetry = () => {
    this.setState({ hasError: false, error: undefined, errorId: undefined });
  };

  private handleReportError = () => {
    if (this.state.error && this.state.errorId) {
      // In a real app, this could open a user feedback form
      const subject = encodeURIComponent(`Error Report - ID: ${this.state.errorId}`);
      const body = encodeURIComponent(`
Error ID: ${this.state.errorId}
Error: ${this.state.error.message}
Timestamp: ${new Date().toISOString()}

Please describe what you were doing when this error occurred:
      `);
      
      window.open(`mailto:support@example.com?subject=${subject}&body=${body}`, '_blank');
    }
  };

  public render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div className="min-h-screen flex items-center justify-center bg-gray-50">
          <div className="max-w-md w-full bg-white shadow-lg rounded-lg p-6">
            <div className="flex items-center mb-4">
              <div className="flex-shrink-0">
                <svg className="h-8 w-8 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.732 16.5c-.77.833.192 2.5 1.732 2.5z" />
                </svg>
              </div>
              <div className="ml-3">
                <h1 className="text-lg font-medium text-gray-900">
                  Something went wrong
                </h1>
              </div>
            </div>
            
            <div className="mb-4">
              <p className="text-sm text-gray-600">
                We apologize for the inconvenience. The error has been reported and we&apos;ll look into it.
              </p>
              
              {this.state.errorId && (
                <p className="text-xs text-gray-500 mt-2">
                  Error ID: <code className="bg-gray-100 px-1 rounded">{this.state.errorId}</code>
                </p>
              )}
            </div>

            <div className="flex space-x-3">
              <button
                onClick={this.handleRetry}
                className="flex-1 bg-blue-600 text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                Try Again
              </button>
              
              <button
                onClick={this.handleReportError}
                className="flex-1 bg-gray-200 text-gray-800 px-4 py-2 rounded-md text-sm font-medium hover:bg-gray-300 focus:outline-none focus:ring-2 focus:ring-gray-500"
              >
                Report Issue
              </button>
            </div>
            
            <div className="mt-4">
              <Link
                href="/"
                className="block text-center text-sm text-blue-600 hover:text-blue-800"
              >
                Return to Home
              </Link>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

// Hook version for functional components
export function useErrorHandler() {
  return (error: Error, errorInfo?: { componentStack?: string }) => {
    logger.error('Manual error report', {
      component: 'useErrorHandler',
      componentStack: errorInfo?.componentStack
    }, error);
    
    trackError(error, {
      component: 'useErrorHandler',
      ...errorInfo
    });
  };
}
