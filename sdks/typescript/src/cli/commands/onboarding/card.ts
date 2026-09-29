import type {
  GuidedOnboardingPath,
  GuidedOnboardingState,
} from "@/client-sdk/services/onboarding/onboarding-api.service";

/** The four paths, titled the way the tour titles them. */
export const GUIDED_PATH_TITLES: Record<GuidedOnboardingPath, string> = {
  llmops: "Evals & LLM Ops",
  coding: "Coding Agent Tracking",
  gateway: "Gateway",
  governance: "Governance",
};

/** The provider slugs the platform stores, written the vendor's own way. */
const PROVIDER_NAMES: Record<string, string> = {
  openai: "OpenAI",
  openai_codex: "Codex",
  anthropic: "Anthropic",
  gemini: "Gemini",
  google_agent_platform: "Google Agent Platform",
  azure: "Azure OpenAI",
  bedrock: "Bedrock",
  vertex_ai: "Vertex AI",
  deepseek: "DeepSeek",
  xai: "xAI",
  groq: "Groq",
  cerebras: "Cerebras",
  custom: "Custom",
};

/** A path's title; a path the platform has not named yet keeps its slug. */
export function guidedPathTitle(path: string): string {
  return (GUIDED_PATH_TITLES as Record<string, string>)[path] ?? path;
}

/**
 * What `onboarding state` prints. Langy runs it inside the panel, where the
 * output lands on a card the person reads as label and value rows, so every
 * value is customer copy: the paths by their titles, the provider the vendor's
 * way with the model beside it, the tour as Completed or Skipped. Nothing that
 * is the platform's own: no conversation id, no timestamps, no replay counter,
 * and no row at all for a tour the path never had or a list with nothing in it.
 */
export interface GuidedStateCard {
  paths: string;
  currentPath?: string;
  donePaths?: string;
  provider?: string;
  tour?: "Completed" | "Skipped";
}

export function guidedStateCard(state: GuidedOnboardingState): GuidedStateCard {
  const titles = (paths: GuidedOnboardingPath[]): string =>
    paths.map(guidedPathTitle).join(", ");
  const provider =
    state.provider === undefined
      ? undefined
      : [PROVIDER_NAMES[state.provider] ?? state.provider, state.providerModel]
          .filter((part) => part !== undefined && part !== "")
          .join(" · ");
  const tour = state.tourCompletedAt
    ? "Completed"
    : state.tourSkippedAt
      ? "Skipped"
      : undefined;
  return {
    paths: titles(state.paths),
    ...(state.currentPath === undefined
      ? {}
      : { currentPath: guidedPathTitle(state.currentPath) }),
    ...(state.donePaths.length === 0 ? {} : { donePaths: titles(state.donePaths) }),
    ...(provider === undefined ? {} : { provider }),
    ...(tour === undefined ? {} : { tour }),
  };
}

/**
 * What `onboarding complete-path` prints: the panel's done marker, one line
 * naming the path that was set up and nothing else. The panel draws the
 * `text` field of a result as the card's body, so the line is the whole card.
 */
export interface GuidedPathDoneCard {
  text: string;
}

export function guidedPathDoneCard(path: string): GuidedPathDoneCard {
  return { text: `${guidedPathTitle(path)} set up` };
}
