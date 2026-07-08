import type { OrganizationIntent } from "@prisma/client";
import {
  type OnboardingFlowConfig,
  OnboardingScreenIndex,
} from "../types/types";

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
 * ADR-038: the flow branches on the declared intent, recomputed from state —
 * the generic navigator itself stays linear (constraint C1).
 *
 * The whole intent fork ships dark behind release_ui_ai_governance_enabled
 * (v5): with the flag off (or still loading) the flow is exactly the
 * pre-fork one — no intent screen at all. False-while-loading is safe:
 * both shapes start at ORGANIZATION, so a late flag flip only inserts
 * screens ahead of the user.
 *
 * The governance track ends AT the intent screen: onboarding creates the
 * org and lands the user on /me, where the existing CLI install surface
 * already teaches setup (v4 — no CLI-related screen or component is
 * touched by onboarding).
 *
 * While intent is undefined the SaaS config takes the LLMOps shape. This
 * is load-bearing: WelcomeScreen derives isLastScreen from array position,
 * and INTENT must not present itself as the final screen before a choice
 * exists on SaaS.
 */
export function getOnboardingFlowConfig(
  isSaaS: boolean,
  intent: OrganizationIntent | undefined,
  intentForkEnabled: boolean,
): OnboardingFlowConfig {
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
