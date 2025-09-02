import fs from 'fs';
import path from 'path';
import matter from 'gray-matter';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

type PostItem = { slug: string; title: string; date?: string };

export default function PostsIndex() {
  const postsDir = path.join(process.cwd(), 'content', 'posts');
  const files = fs.existsSync(postsDir) ? fs.readdirSync(postsDir) : [];
  const items: PostItem[] = files
    .filter((f) => f.endsWith('.md'))
    .map((filename) => {
      const slug = filename.replace(/\.md$/, '');
      const raw = fs.readFileSync(path.join(postsDir, filename), 'utf8');
      const { data } = matter(raw);
      const title = typeof data.title === 'string' ? data.title : slug;
      const date = typeof data.date === 'string' ? data.date : undefined;
      return { slug, title, date };
    })
    .sort((a, b) => (b.date?.localeCompare(a.date ?? '') ?? 0));

  return (
    <main className="mx-auto max-w-3xl p-6">
      <h1 className="text-2xl font-semibold mb-4">Posts</h1>
      <ul className="space-y-3">
        {items.map((p) => (
          <li key={p.slug} className="flex items-center justify-between">
            <Link className="text-blue-600 hover:underline" href={`/posts/${p.slug}`}>
              {p.title}
            </Link>
            {p.date && <span className="text-sm text-gray-500">{p.date}</span>}
          </li>
        ))}
        {items.length === 0 && <li>No posts yet.</li>}
      </ul>
    </main>
  );
}
