/**
 * Which providers the onboarding step offers, in the order it offers them.
 *
 * Codex leads with a "Recommended" badge because a reader who already pays for
 * ChatGPT gets a working model without pasting a key; everything else keeps
 * registry order. Deprecated providers accept no new rows, so offering one
 * would be a card that leads to a refusal.
 */

import { modelProviders, providerDeprecation } from "@langwatch/model-provider-contract";

export const RECOMMENDED_ONBOARDING_PROVIDER = "openai_codex";

export type OnboardingModelProvider = {
  readonly provider: string;
  readonly name: string;
  readonly recommended: boolean;
};

export function onboardingModelProviders(): OnboardingModelProvider[] {
  const offered = Object.entries(modelProviders)
    .filter(([provider, entry]) => entry.type === "llm" && !providerDeprecation(provider))
    .map(([provider, entry]) => ({
      provider,
      name: entry.name,
      recommended: provider === RECOMMENDED_ONBOARDING_PROVIDER,
    }));

  return [
    ...offered.filter((candidate) => candidate.recommended),
    ...offered.filter((candidate) => !candidate.recommended),
  ];
}
