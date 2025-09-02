import { Suspense } from 'react';
import { Metadata } from 'next';
import matter from 'gray-matter';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeSlug from 'rehype-slug';
import rehypeAutolinkHeadings from 'rehype-autolink-headings';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createServices } from '@/lib/utils/database';
import { initializeCache } from '@/lib/utils/cache';
import { measureAsync, getGlobalPerformanceMonitor } from '@/lib/utils/performance';
import { logger } from '@/lib/utils/logger';
import { PostViewTracker } from './PostViewTracker';

export const dynamic = 'force-dynamic';

// Initialize services
let services: ReturnType<typeof createServices>;

async function initializeServices() {
  if (!services) {
    const cache = await initializeCache();
    services = createServices(cache);
  }
}

async function getPost(slug: string) {
  await initializeServices();
  
  return await measureAsync(
    'page_render',
    async () => {
      // Try to get from database first
      const dbPost = await services.posts.getPostBySlug(slug, false);
      if (dbPost) {
        return {
          id: dbPost.id,
          title: dbPost.title,
          content: dbPost.content,
          date: dbPost.publishedAt?.toISOString().split('T')[0],
          readingTime: dbPost.readingTime || undefined,
          wordCount: dbPost.wordCount || undefined,
          excerpt: dbPost.excerpt || undefined,
          isFromDatabase: true,
        };
      }

      // Fallback to file system
      const fs = await import('fs');
      const path = await import('path');
      const filePath = path.join(process.cwd(), 'content', 'posts', `${slug}.md`);
      
      if (!fs.existsSync(filePath)) return null;
      
      const raw = fs.readFileSync(filePath, 'utf8');
      const { data, content } = matter(raw);
      const title = typeof data.title === 'string' ? data.title : slug;
      const date = typeof data.date === 'string' ? data.date : undefined;
      
      return { 
        title, 
        date, 
        content,
        readingTime: data.readingTime,
        wordCount: data.wordCount,
        excerpt: data.excerpt,
        isFromDatabase: false,
      };
    },
    getGlobalPerformanceMonitor(),
    { slug, source: 'post_page' }
  );
}

// Generate metadata for SEO
export async function generateMetadata(
  { params }: { params: Promise<{ slug: string }> }
): Promise<Metadata> {
  const { slug } = await params;
  const post = await getPost(slug);
  
  if (!post) {
    return {
      title: 'Post Not Found',
    };
  }

  return {
    title: post.title,
    description: post.excerpt || `Read "${post.title}" on MR Blog`,
    openGraph: {
      title: post.title,
      description: post.excerpt || `Read "${post.title}" on MR Blog`,
      type: 'article',
      publishedTime: post.date,
    },
  };
}

function PostContent({ post, slug }: { 
  post: {
    id?: string;
    title: string;
    content: string;
    date?: string;
    readingTime?: number;
    wordCount?: number;
    excerpt?: string;
    isFromDatabase: boolean;
  }; 
  slug: string; 
}) {
  return (
    <main className="mx-auto max-w-3xl p-6 prose">
      <p>
        <Link className="text-blue-600 hover:underline" href="/posts">← Back to Posts</Link>
      </p>
      
      <div className="mb-6">
        <h1 className="mb-2">{post.title}</h1>
        {post.date && <p className="text-sm text-gray-500 mb-2">{post.date}</p>}
        
        <div className="flex gap-4 text-sm text-gray-600 mb-4">
          {post.readingTime && <span>📖 {post.readingTime} min read</span>}
          {post.wordCount && <span>📝 {post.wordCount} words</span>}
          {post.isFromDatabase && <span className="bg-green-100 px-2 py-1 rounded">🚀 Cached</span>}
        </div>
        
        {post.excerpt && (
          <p className="text-lg text-gray-700 italic border-l-4 border-blue-200 pl-4 mb-6">
            {post.excerpt}
          </p>
        )}
      </div>

      <hr className="my-6" />
      
      <article>
        <ReactMarkdown 
          remarkPlugins={[remarkGfm]} 
          rehypePlugins={[rehypeSlug, [rehypeAutolinkHeadings, { behavior: 'wrap' }]]}
        >
          {post.content}
        </ReactMarkdown>
      </article>

      {/* Track page view */}
      <PostViewTracker postId={post.id} slug={slug} />
    </main>
  );
}

export default async function PostPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  
  try {
    const post = await getPost(slug);
    if (!post) return notFound();

    return (
      <Suspense fallback={
        <main className="mx-auto max-w-3xl p-6 prose">
          <div className="animate-pulse">
            <div className="h-4 bg-gray-200 rounded w-24 mb-4"></div>
            <div className="h-8 bg-gray-200 rounded w-3/4 mb-2"></div>
            <div className="h-4 bg-gray-200 rounded w-32 mb-4"></div>
            <div className="space-y-2">
              <div className="h-4 bg-gray-200 rounded"></div>
              <div className="h-4 bg-gray-200 rounded w-5/6"></div>
              <div className="h-4 bg-gray-200 rounded w-4/6"></div>
            </div>
          </div>
        </main>
      }>
        <PostContent post={post} slug={slug} />
      </Suspense>
    );
  } catch (error) {
    logger.error('Error loading post page', {
      component: 'post_page',
      slug,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
    
    return notFound();
  }
}
