import type { OrganizationIntent } from "@langwatch/organization-contract";
import { type OnboardingFlowConfig, OnboardingScreenIndex } from "./types.ts";

function buildConfig(
  variant: OnboardingFlowConfig["variant"],
  visibleScreens: OnboardingScreenIndex[],
): OnboardingFlowConfig {
  return {
    variant,
    visibleScreens,
    first: visibleScreens[0]!,
    last: visibleScreens[visibleScreens.length - 1]!,
    total: visibleScreens.length,
  };
}

/**
 * Flow branches on intent (ADR-038). Governance track ends at intent screen;
 * undefined intent uses LLMOps shape.
 */
export function getOnboardingFlowConfig({
  isSaaS,
  intent,
  intentForkEnabled,
}: {
  isSaaS: boolean;
  intent: OrganizationIntent | undefined;
  intentForkEnabled: boolean;
}): OnboardingFlowConfig {
  if (!intentForkEnabled) {
    return isSaaS
      ? buildConfig("full", [
          OnboardingScreenIndex.ORGANIZATION,
          OnboardingScreenIndex.BASIC_INFO,
          OnboardingScreenIndex.DESIRES,
          OnboardingScreenIndex.ROLE,
        ])
      : buildConfig("self_hosted", [OnboardingScreenIndex.ORGANIZATION]);
  }

  if (isSaaS && intent !== "AGENT_GOVERNANCE") {
    return buildConfig("full", [
      OnboardingScreenIndex.ORGANIZATION,
      OnboardingScreenIndex.INTENT,
      OnboardingScreenIndex.BASIC_INFO,
      OnboardingScreenIndex.DESIRES,
      OnboardingScreenIndex.ROLE,
    ]);
  }

  return buildConfig(isSaaS ? "full" : "self_hosted", [
    OnboardingScreenIndex.ORGANIZATION,
    OnboardingScreenIndex.INTENT,
  ]);
}
