# MR Blog Generator

Next.js app that generates Markdown posts via a simple three-agent workflow (Researcher → Analyst → Strategist).

What it does
- Collects a topic and target questions in the UI
- Researcher searches the web and scrapes 5–10 relevant sources
- Analyst summarizes each source and extracts key bullets
- Strategist creates an outline and emits a Markdown post with frontmatter
- Saves to `content/posts/<slug>.md` and shows a live preview

Run locally
```bash
npm run dev
```
Open http://localhost:3000 and fill out the form.

Implementation
- API: `POST /api/generate` runs the workflow and writes the `.md` file
- Preview: `GET /api/post/[slug]` returns the saved Markdown
- Agents in `src/lib/agents/*`, orchestration in `src/lib/orchestrator.ts`

Notes
- Search uses DuckDuckGo HTML scraping to avoid API keys; swap in a search API for robustness.
- Content extraction is heuristic. Consider a readability library or paid API for production.
