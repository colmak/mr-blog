export type Source = {
  title: string;
  url: string;
  snippet?: string;
  content?: string;
};

export type ResearchInput = {
  topic: string;
  maxSources: number;
  researcherInstructions?: string;
};

export type ResearchOutput = {
  sources: Source[];
};

export type AnalysisInput = {
  sources: Source[];
  analystInstructions?: string;
};

export type AnalyzedSource = Source & {
  summary: string;
  keyTakeaways: string[];
};

export type AnalysisOutput = {
  analyzed: AnalyzedSource[];
};

export type StrategyInput = {
  topic: string;
  targetQuestions: string[];
  analyzed: AnalyzedSource[];
  audience?: string;
  tone?: string;
  strategistInstructions?: string;
};

export type StrategyOutput = {
  title: string;
  outline: Array<{
    heading: string;
    points: string[];
  }>;
  markdown: string;
  slug: string;
  sources: Source[];
};
