import fs from 'fs';
import path from 'path';
import matter from 'gray-matter';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeSlug from 'rehype-slug';
import rehypeAutolinkHeadings from 'rehype-autolink-headings';
import Link from 'next/link';
import { notFound } from 'next/navigation';

export const dynamic = 'force-dynamic';

function getPost(slug: string) {
  const filePath = path.join(process.cwd(), 'content', 'posts', `${slug}.md`);
  if (!fs.existsSync(filePath)) return null;
  const raw = fs.readFileSync(filePath, 'utf8');
  const { data, content } = matter(raw);
  const title = typeof data.title === 'string' ? data.title : slug;
  const date = typeof data.date === 'string' ? data.date : undefined;
  return { title, date, content };
}

export default async function PostPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const post = getPost(slug);
  if (!post) return notFound();
  return (
  <main className="mx-auto max-w-3xl p-6 prose">
      <p>
        <Link className="text-blue-600 hover:underline" href="/posts">← Back to Posts</Link>
      </p>
      <h1 className="mb-2">{post.title}</h1>
      {post.date && <p className="text-sm text-gray-500">{post.date}</p>}
      <hr className="my-4" />
      <article>
        <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSlug, [rehypeAutolinkHeadings, { behavior: 'wrap' }]]}>
          {post.content}
        </ReactMarkdown>
      </article>
    </main>
  );
}
