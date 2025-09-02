'use client';

import { useEffect } from 'react';
import { logger } from '@/lib/utils/logger';

interface PostViewTrackerProps {
  postId?: string;
  slug: string;
}

export function PostViewTracker({ postId, slug }: PostViewTrackerProps) {
  useEffect(() => {
    // Track page view when component mounts
    const trackView = async () => {
      try {
        const startTime = performance.now();
        
        // Track the view
        const response = await fetch('/api/analytics/track-view', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            postId,
            slug,
            userAgent: navigator.userAgent,
            referer: document.referrer,
            loadTime: Math.round(performance.now() - startTime),
            url: window.location.href,
            timestamp: Date.now(),
          }),
        });

        if (!response.ok) {
          throw new Error(`Failed to track view: ${response.status}`);
        }

        logger.debug('Post view tracked', { component: 'PostViewTracker', slug });
      } catch (error) {
        logger.error('Failed to track post view', {
          component: 'PostViewTracker',
          slug,
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    };

    // Track view with a small delay to ensure page is fully loaded
    const timer = setTimeout(trackView, 1000);

    return () => clearTimeout(timer);
  }, [postId, slug]);

  // This component doesn't render anything
  return null;
}
