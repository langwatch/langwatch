/**
 * Which providers Langy offers inline when a project has none. Codex leads: a
 * reader who already pays for ChatGPT gets a working model without pasting a
 * key. Everything else keeps registry order, and a deprecated one is dropped.
 */
import { modelProviders, providerDeprecation } from "@langwatch/model-provider-contract";

export const LANGY_RECOMMENDED_PROVIDER = "openai_codex";

export type LangyModelProvider = {
  readonly provider: string;
  readonly name: string;
  readonly recommended: boolean;
};

export function langyModelProviders(): LangyModelProvider[] {
  const offered = Object.entries(modelProviders)
    .filter(([provider, entry]) => entry.type === "llm" && !providerDeprecation(provider))
    .map(([provider, entry]) => ({
      provider,
      name: entry.name,
      recommended: provider === LANGY_RECOMMENDED_PROVIDER,
    }));

  return [
    ...offered.filter((candidate) => candidate.recommended),
    ...offered.filter((candidate) => !candidate.recommended),
  ];
}
