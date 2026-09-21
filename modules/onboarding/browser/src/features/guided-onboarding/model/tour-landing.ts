/**
 * What a landing after the guided takeover owes: a tour still to run, a
 * kickoff still to queue, and the kickoff message itself. Framework-free.
 * @see specs/features/onboarding/guided-tour.feature
 */
import type {
  GuidedOnboardingState,
  GuidedOnboardingStateWithInstance,
  GuidedPath,
} from "@langwatch/onboarding-contract";

import type { GuidedKickoff, GuidedKickoffTourStatus } from "./kickoff.ts";
import { pathHasTour } from "./tour-steps.ts";

/** The first name the greeting uses, or nothing when the account has none. */
export function firstNameOf(name: string | null | undefined): string | undefined {
  const trimmed = name?.trim();
  if (!trimmed || trimmed.includes("@")) return undefined;
  return trimmed.split(/\s+/)[0];
}

export function buildKickoff({
  path,
  state,
  orgName,
  firstName,
  tourStatus,
}: {
  path: GuidedPath;
  state: GuidedOnboardingStateWithInstance;
  orgName: string;
  firstName: string | undefined;
  tourStatus: GuidedKickoffTourStatus;
}): GuidedKickoff {
  return {
    path,
    paths: state.paths,
    provider: state.provider,
    providerModel: state.providerModel,
    orgName,
    firstName,
    tourStatus,
    gatewayUrl: state.gatewayUrl,
    virtualKeyName: state.virtualKeyName,
    virtualKeyPreview: state.virtualKeyPreview,
    virtualKeyRevealId: state.virtualKeyRevealId,
    /* the conversation to continue whenever the guided state has one; the
       panel drain never queries for it */
    conversationId: state.conversationId ?? null,
  };
}

/** The landing has a tour to run when the path has one and none ended yet. */
export function landingNeedsTour(state: GuidedOnboardingState): boolean {
  return (
    !!state.currentPath &&
    pathHasTour(state.currentPath) &&
    !state.tourCompletedAt &&
    !state.tourSkippedAt
  );
}

/** Whether the landing still owes the panel its kickoff. */
export function landingNeedsKickoff(state: GuidedOnboardingState): boolean {
  return !!state.currentPath && !state.conversationId;
}

/**
 * How the tour ended, for a landing that queues the kickoff without running
 * one: a path with no tour never had one, and a path with a tour reached
 * this point because a previous landing already ended it.
 */
export function tourStatusForLanding(
  state: GuidedOnboardingState,
  path: GuidedPath,
): GuidedKickoffTourStatus {
  if (!pathHasTour(path)) return "none";
  const skippedAndNotCompleted = !!state.tourSkippedAt && !state.tourCompletedAt;
  return skippedAndNotCompleted ? "skipped" : "completed";
}
