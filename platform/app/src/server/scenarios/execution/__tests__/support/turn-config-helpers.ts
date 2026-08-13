import { vi } from "vitest";
import type { DataPrefetcherDependencies } from "../../data-prefetcher";
import type { LiteLLMParams } from "../../types";

const defaultModelParams: LiteLLMParams = {
  api_key: "sk-test",
  model: "openai/gpt-5-mini",
};

const defaultPrompt = {
  id: "prompt_1",
  prompt: "You are a test assistant",
  messages: [],
  model: "openai/gpt-5-mini",
  temperature: 0.7,
  maxTokens: 1000,
};

export function createMockDepsForTurnConfig(overrides: {
  scenario: {
    id: string;
    name: string;
    situation: string;
    criteria: string[];
    labels: string[];
    simulatorModel: string | null;
    judgeModel: string | null;
    maxTurns: number | null;
    minTurns: number | null;
  };
}): DataPrefetcherDependencies {
  return {
    scenarioFetcher: {
      getById: vi.fn().mockResolvedValue(overrides.scenario),
    },
    suiteConfigFetcher: {
      getBySetId: vi.fn().mockResolvedValue(null),
    },
    promptFetcher: {
      getPromptByIdOrHandle: vi.fn().mockResolvedValue(defaultPrompt),
    },
    agentFetcher: {
      findById: vi.fn().mockResolvedValue(null),
    },
    workflowVersionFetcher: {
      getLatestDsl: vi.fn().mockResolvedValue(null),
    },
    projectFetcher: {
      findUnique: vi.fn().mockResolvedValue({ apiKey: "test-api-key" }),
    },
    modelParamsProvider: {
      prepare: vi
        .fn()
        .mockResolvedValue({ success: true, params: defaultModelParams }),
    },
    modelResolver: {
      resolve: vi.fn().mockImplementation(async (featureKey: string) => {
        const map: Record<string, string> = {
          "scenarios.user_simulator": "openai/sim-default",
          "scenarios.judge": "openai/judge-default",
          "scenarios.agent_under_test": "anthropic/claude-3-sonnet",
        };
        return map[featureKey] ?? "openai/fallback";
      }),
    },
    projectSecretsFetcher: {
      getSecrets: vi.fn().mockResolvedValue({}),
    },
  };
}
