import { runResearch } from './agents/researcher';
import { runAnalysis } from './agents/analyst';
import { runStrategy } from './agents/strategist';
import { ResearchInput, StrategyOutput } from './agents/types';

export type OrchestratorInput = {
  topic: string;
  targetQuestions: string[];
  maxSources?: number;
  audience?: string;
  tone?: string;
  useLLM?: boolean;
  model?: string;
};

export async function generatePost(input: OrchestratorInput): Promise<StrategyOutput> {
  const researchInput: ResearchInput = { topic: input.topic, maxSources: input.maxSources ?? 6 };
  const research = await runResearch(researchInput);
  const analysis = await runAnalysis({ sources: research.sources, useLLM: input.useLLM, model: input.model });
  const strategy = await runStrategy({
    topic: input.topic,
    targetQuestions: input.targetQuestions,
    analyzed: analysis.analyzed,
    audience: input.audience,
    tone: input.tone,
    useLLM: input.useLLM,
    model: input.model,
  });
  return strategy;
}
