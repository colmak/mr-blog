"use client";
import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeSlug from 'rehype-slug';
import rehypeAutolinkHeadings from 'rehype-autolink-headings';
import matter from 'gray-matter';
import Link from 'next/link';

export default function Home() {
  const [topic, setTopic] = useState('');
  const [questionsText, setQuestionsText] = useState('');
  const [maxSources, setMaxSources] = useState(6);
  const [audience, setAudience] = useState('General tech audience');
  const [tone, setTone] = useState('Informative and concise');
  const [useLLM, setUseLLM] = useState(true);
  const [model, setModel] = useState('gpt-4o-mini');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [markdown, setMarkdown] = useState('');
  const [slug, setSlug] = useState('');
  const [, setTitle] = useState('');
  const [progress, setProgress] = useState<string[]>([]);

  const generate = async () => {
    setLoading(true);
    setError(null);
    setMarkdown('');
    setProgress([]);
    try {
      const targetQuestions = questionsText.split('\n').map(s => s.trim()).filter(Boolean);
      const res = await fetch('/api/generate/stream', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ topic, targetQuestions, maxSources, audience, tone, useLLM, model }),
      });
      if (!res.ok || !res.body) throw new Error('Failed to start generation');
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      const log = (line: string) => setProgress(prev => [...prev, line]);
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let idx;
        while ((idx = buffer.indexOf('\n\n')) !== -1) {
          const chunk = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);
          const lines = chunk.split('\n');
          const eventLine = lines.find(l => l.startsWith('event:'));
          const dataLine = lines.find(l => l.startsWith('data:'));
          const event = eventLine ? eventLine.replace('event:','').trim() : '';
          if (dataLine) {
            try {
              const payload = JSON.parse(dataLine.replace('data:','').trim());
              if (event === 'status') {
                log(`${payload.phase}: ${payload.message}`);
              } else if (event === 'done') {
                setSlug(payload.slug);
                setTitle(payload.title);
              } else if (event === 'error') {
                throw new Error(payload.message || 'Generation error');
              }
            } catch {
              // ignore malformed chunk
            }
          }
        }
      }
      if (!slug) {
        // fetch markdown after done event
        const finalSlug = buffer.match(/"slug":"([^"]+)"/);
        const s = finalSlug?.[1] || slug;
        if (s) setSlug(s);
      }
      if (slug) {
        const mdRes = await fetch(`/api/post/${slug}`);
        const md = await mdRes.text();
        const parsed = matter(md);
        setMarkdown(parsed.content);
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Unknown error';
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="mx-auto max-w-5xl p-6 space-y-6">
      <h1 className="text-3xl font-bold">MR Blog Generator</h1>
      <div className="grid md:grid-cols-2 gap-6">
        <div className="space-y-3">
          <label className="block text-sm font-medium">Topic</label>
          <input className="w-full border rounded p-2" value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="e.g. Edge AI for IoT" />

          <label className="block text-sm font-medium mt-4">Target Questions (one per line)</label>
          <textarea className="w-full border rounded p-2 h-40" value={questionsText} onChange={(e) => setQuestionsText(e.target.value)} placeholder={`e.g.\nWhat is Edge AI?\nWhy use Edge AI in IoT?\nWhat are the challenges?`} />

          <div className="grid grid-cols-3 gap-3 mt-4">
            <div>
              <label className="block text-sm font-medium">Max Sources</label>
              <input type="number" className="w-full border rounded p-2" value={maxSources} min={3} max={10} onChange={(e) => setMaxSources(parseInt(e.target.value || '6'))} />
            </div>
            <div className="col-span-3 grid grid-cols-3 gap-3">
              <label className="flex items-center gap-2 text-sm font-medium">
                <input type="checkbox" checked={useLLM} onChange={(e) => setUseLLM(e.target.checked)} />
                Use OpenAI
              </label>
              <div className="col-span-2">
                <label className="block text-sm font-medium">Model</label>
                <input className="w-full border rounded p-2" value={model} onChange={(e) => setModel(e.target.value)} placeholder="gpt-4o-mini" />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium">Audience</label>
              <input className="w-full border rounded p-2" value={audience} onChange={(e) => setAudience(e.target.value)} />
            </div>
            <div>
              <label className="block text-sm font-medium">Tone</label>
              <input className="w-full border rounded p-2" value={tone} onChange={(e) => setTone(e.target.value)} />
            </div>
          </div>

          <button disabled={loading || !topic} onClick={generate} className="mt-4 bg-black text-white px-4 py-2 rounded disabled:opacity-50">
            {loading ? 'Generating…' : 'Generate Blog'}
          </button>
          {error && <p className="text-red-600 text-sm mt-2">{error}</p>}
          {slug && (
            <p className="text-sm mt-2">
              Saved as: <code>content/posts/{slug}.md</code> ·{' '}
              <Link className="text-blue-600 hover:underline" href={`/posts/${slug}`}>View post</Link>
            </p>
          )}
          <p className="text-sm mt-2">
            <Link className="text-blue-600 hover:underline" href="/posts">View all posts</Link>
          </p>
          {progress.length > 0 && (
            <div className="mt-4 border rounded p-2 bg-gray-50 text-sm max-h-40 overflow-auto">
              <div className="font-medium mb-1">Progress</div>
              <ul className="list-disc list-inside space-y-1">
                {progress.map((p, i) => <li key={i}>{p}</li>)}
              </ul>
            </div>
          )}
        </div>
        <div>
          <label className="block text-sm font-medium">Preview</label>
          <div className="border rounded p-4 bg-white prose max-w-none">
            {markdown ? (
              <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSlug, [rehypeAutolinkHeadings, { behavior: 'wrap' }]]}>
                {markdown}
              </ReactMarkdown>
            ) : (
              <p className="text-gray-500">No content yet.</p>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}
 
