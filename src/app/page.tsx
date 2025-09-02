"use client";
import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeSlug from 'rehype-slug';
import rehypeAutolinkHeadings from 'rehype-autolink-headings';
import matter from 'gray-matter';
import Link from 'next/link';
import { useErrorHandler } from '@/lib/components/ErrorBoundary';

interface GenerateError {
  message: string;
  code?: string;
}

export default function Home() {
  const [topic, setTopic] = useState('');
  const [questionsText, setQuestionsText] = useState('');
  const [maxSources, setMaxSources] = useState(6);
  const [audience, setAudience] = useState('General tech audience');
  const [tone, setTone] = useState('Informative and concise');
  const [useLLM, setUseLLM] = useState(true);
  const [model, setModel] = useState('gpt-4o-mini');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<GenerateError | null>(null);
  const [markdown, setMarkdown] = useState('');
  const [slug, setSlug] = useState('');
  const [title, setPostTitle] = useState('');
  const [progress, setProgress] = useState<string[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  
  const reportError = useErrorHandler();

  const validateForm = (): string | null => {
    if (!topic.trim()) return 'Topic is required';
    if (topic.length < 3) return 'Topic must be at least 3 characters';
    if (topic.length > 200) return 'Topic must be less than 200 characters';
    
    const questions = questionsText.split('\n').map(s => s.trim()).filter(Boolean);
    if (questions.length === 0) return 'At least one question is required';
    if (questions.length > 10) return 'Maximum 10 questions allowed';
    
    for (const q of questions) {
      if (q.length < 5) return 'Each question must be at least 5 characters';
      if (q.length > 500) return 'Each question must be less than 500 characters';
    }
    
    if (maxSources < 3 || maxSources > 10) return 'Max sources must be between 3 and 10';
    
    return null;
  };

  const generate = async () => {
    // Reset state
    setError(null);
    setMarkdown('');
    setProgress([]);
    setSlug('');
    setPostTitle('');
    setIsStreaming(false);
    
    // Validate form
    const validationError = validateForm();
    if (validationError) {
      setError({ message: validationError, code: 'VALIDATION_ERROR' });
      return;
    }

    setLoading(true);
    setIsStreaming(true);

    try {
      const targetQuestions = questionsText.split('\n').map(s => s.trim()).filter(Boolean);
      const res = await fetch('/api/generate/stream', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ topic, targetQuestions, maxSources, audience, tone, useLLM, model }),
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.error || `Server error: ${res.status}`);
      }

      if (!res.body) {
        throw new Error('No response body received');
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      const log = (line: string) => setProgress(prev => [...prev, line]);

      try {
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
            const event = eventLine ? eventLine.replace('event:', '').trim() : '';
            
            if (dataLine) {
              try {
                const payload = JSON.parse(dataLine.replace('data:', '').trim());
                if (event === 'status') {
                  log(`${payload.phase}: ${payload.message}`);
                } else if (event === 'done') {
                  setSlug(payload.slug);
                  setPostTitle(payload.title);
                  setIsStreaming(false);
                } else if (event === 'error') {
                  throw new Error(payload.message || 'Generation error');
                }
              } catch (parseError) {
                console.warn('Failed to parse SSE data:', parseError);
              }
            }
          }
        }
      } finally {
        reader.releaseLock();
      }

      // Fetch the generated markdown
      if (slug) {
        const mdRes = await fetch(`/api/post/${slug}`);
        if (mdRes.ok) {
          const md = await mdRes.text();
          const parsed = matter(md);
          setMarkdown(parsed.content);
        } else {
          throw new Error('Failed to fetch generated post');
        }
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error occurred';
      setError({ message: errorMessage });
      reportError(err instanceof Error ? err : new Error(errorMessage), {
        componentStack: 'HomePage/generate'
      });
    } finally {
      setLoading(false);
      setIsStreaming(false);
    }
  };

  return (
    <main className="mx-auto max-w-5xl p-6 space-y-6">
      <div className="text-center">
        <h1 className="text-3xl font-bold text-gray-900">MR Blog Generator</h1>
        <p className="text-gray-600 mt-2">AI-powered blog post generation with research and analysis</p>
      </div>
      
      <div className="grid md:grid-cols-2 gap-6">
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700">
              Topic <span className="text-red-500">*</span>
            </label>
            <input 
              className="w-full mt-1 border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500" 
              value={topic} 
              onChange={(e) => setTopic(e.target.value)} 
              placeholder="e.g. Edge AI for IoT"
              maxLength={200}
              disabled={loading}
            />
            <p className="text-xs text-gray-500 mt-1">{topic.length}/200 characters</p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700">
              Target Questions (one per line) <span className="text-red-500">*</span>
            </label>
            <textarea 
              className="w-full mt-1 border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500" 
              rows={6}
              value={questionsText} 
              onChange={(e) => setQuestionsText(e.target.value)} 
              placeholder={`What is Edge AI?\nWhy use Edge AI in IoT?\nWhat are the challenges?`}
              disabled={loading}
            />
            <p className="text-xs text-gray-500 mt-1">
              {questionsText.split('\n').filter(Boolean).length}/10 questions
            </p>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700">Max Sources</label>
              <input 
                type="number" 
                className="w-full mt-1 border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500" 
                value={maxSources} 
                min={3} 
                max={10} 
                onChange={(e) => setMaxSources(parseInt(e.target.value || '6'))}
                disabled={loading}
              />
            </div>
            
            <div className="flex items-center">
              <label className="flex items-center gap-2 text-sm font-medium text-gray-700">
                <input 
                  type="checkbox" 
                  checked={useLLM} 
                  onChange={(e) => setUseLLM(e.target.checked)}
                  disabled={loading}
                  className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                />
                Use OpenAI
              </label>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700">Audience</label>
              <input 
                className="w-full mt-1 border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500" 
                value={audience} 
                onChange={(e) => setAudience(e.target.value)}
                maxLength={100}
                disabled={loading}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700">Tone</label>
              <input 
                className="w-full mt-1 border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500" 
                value={tone} 
                onChange={(e) => setTone(e.target.value)}
                maxLength={100}
                disabled={loading}
              />
            </div>
          </div>

          {useLLM && (
            <div>
              <label className="block text-sm font-medium text-gray-700">Model</label>
              <input 
                className="w-full mt-1 border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500" 
                value={model} 
                onChange={(e) => setModel(e.target.value)} 
                placeholder="gpt-4o-mini"
                disabled={loading}
              />
            </div>
          )}

          <button 
            disabled={loading || !topic.trim()} 
            onClick={generate} 
            className="w-full bg-blue-600 text-white px-4 py-2 rounded-md font-medium hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? (isStreaming ? 'Generating...' : 'Processing...') : 'Generate Blog'}
          </button>

          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-md">
              <p className="text-sm font-medium">Error</p>
              <p className="text-sm">{error.message}</p>
            </div>
          )}

          {slug && title && (
            <div className="bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded-md">
              <p className="text-sm">
                <strong>Generated:</strong> {title}
              </p>
              <p className="text-xs mt-1">
                <Link className="text-blue-600 hover:underline" href={`/posts/${slug}`}>
                  View post
                </Link>
                {' • '}
                <Link className="text-blue-600 hover:underline" href="/posts">
                  View all posts
                </Link>
              </p>
            </div>
          )}

          {progress.length > 0 && (
            <div className="bg-blue-50 border border-blue-200 rounded-md p-4">
              <div className="font-medium text-blue-900 mb-2 flex items-center gap-2">
                {isStreaming && (
                  <div className="w-4 h-4 border-2 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
                )}
                Progress
              </div>
              <div className="max-h-40 overflow-auto">
                <ul className="list-disc list-inside space-y-1 text-sm text-blue-800">
                  {progress.map((p, i) => <li key={i}>{p}</li>)}
                </ul>
              </div>
            </div>
          )}
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">Preview</label>
          <div className="border border-gray-300 rounded-md p-4 bg-white prose max-w-none max-h-96 overflow-auto">
            {markdown ? (
              <ReactMarkdown 
                remarkPlugins={[remarkGfm]} 
                rehypePlugins={[rehypeSlug, [rehypeAutolinkHeadings, { behavior: 'wrap' }]]}
              >
                {markdown}
              </ReactMarkdown>
            ) : (
              <p className="text-gray-500">Generated content will appear here...</p>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}
 
