import { useUiDeclarations } from "@langwatch/browser-host/capabilities";
import type { UiGuidedPathActive } from "@langwatch/browser-host/declarations";
import { useEffect, useRef } from "react";

import { useOnboardingStore } from "../../../../../behavior/explorer/onboarding/store/onboarding-store.ts";
import { TRACE_EXPLORER_SPOTLIGHTS } from "../../../../../model/explorer/onboarding/spotlights/spotlights.ts";
import { writeSpotlightFragment } from "../spotlights/spotlight-overlay.tsx";
import { useTraceExplorerTourPreference } from "./use-trace-explorer-tour-preference.ts";

/** A composition without onboarding has no guided path to stay quiet for. */
const NO_GUIDED_PATH: UiGuidedPathActive = { useIsActive: () => false };

interface UseFirstTraceSpotlightTriggerArgs {
  projectId: string | null;
  hasAnyTraces: boolean | undefined;
}

function shouldMigrateLegacyTour({
  attempted,
  isDismissed,
  isResolved,
  hasLegacyHistory,
}: {
  attempted: boolean;
  isDismissed: boolean;
  isResolved: boolean;
  hasLegacyHistory: boolean;
}): boolean {
  const alreadyHandled = attempted || isDismissed;
  const canMigrate = isResolved && hasLegacyHistory;
  return !alreadyHandled && canMigrate;
}

/** Traces have landed in a project the user has not yet been shown them in, nor is mid-path. */
function isFirstTraceSpotlightDue(input: {
  projectId: string | null;
  hasAnyTraces: boolean | undefined;
  isDismissed: boolean;
  guidedPathActive: boolean;
  firstTraceSpotlightFired: boolean;
}): boolean {
  if (!input.projectId || input.hasAnyTraces !== true) return false;
  return !input.isDismissed && !input.guidedPathActive && !input.firstTraceSpotlightFired;
}

function startFirstTraceSpotlights(): void {
  // Re-check inside the timer because the user could have
  // navigated away or started spotlights manually during the
  // breath. The first-trace flag stays unset until we actually
  // fire, so a navigation away preserves the auto-start intent
  // for the next visit.
  const state = useOnboardingStore.getState();
  if (state.spotlightsActive || state.tourActive) {
    state.markFirstTraceSpotlightFired();
    return;
  }
  const first = TRACE_EXPLORER_SPOTLIGHTS[0];
  const firstId = first?.id ?? null;
  state.setCurrentSpotlightId(firstId);
  state.setSpotlightsActive(true);
  writeSpotlightFragment(firstId);
  state.markFirstTraceSpotlightFired();
}

/**
 * One-shot automatic effect: the moment `hasAnyTraces` flips to true in any project
 * where we have not auto-fired the spotlight tour, start the contextual walkthrough of
 * the user's data.
 */
export function useFirstTraceSpotlightTrigger({
  projectId,
  hasAnyTraces,
}: UseFirstTraceSpotlightTriggerArgs): void {
  const { dismiss: persistDismissal, isDismissed, isResolved } = useTraceExplorerTourPreference();
  const firstTraceSpotlightFired = useOnboardingStore((s) => s.firstTraceSpotlightFired);
  const seenDrawerSpotlights = useOnboardingStore((s) => s.seenDrawerSpotlights);
  const markFired = useOnboardingStore((s) => s.markFirstTraceSpotlightFired);
  const spotlightsActive = useOnboardingStore((s) => s.spotlightsActive);
  const tourActive = useOnboardingStore((s) => s.tourActive);
  const setSpotlightsActive = useOnboardingStore((s) => s.setSpotlightsActive);
  const setCurrentSpotlightId = useOnboardingStore((s) => s.setCurrentSpotlightId);
  const guidedPath = useUiDeclarations().declared("guidedPathActive")[0]?.capability;
  const guidedPathActive = (guidedPath ?? NO_GUIDED_PATH).useIsActive();
  const hasLegacyTourHistoryOnMount = useRef(
    firstTraceSpotlightFired || Object.keys(seenDrawerSpotlights).length > 0,
  ).current;
  const hasLegacyMigrationAttempted = useRef(false);

  useEffect(() => {
    const shouldMigrate = shouldMigrateLegacyTour({
      attempted: hasLegacyMigrationAttempted.current,
      isDismissed,
      isResolved,
      hasLegacyHistory: hasLegacyTourHistoryOnMount,
    });
    if (!shouldMigrate) return;
    hasLegacyMigrationAttempted.current = true;
    persistDismissal();
  }, [hasLegacyTourHistoryOnMount, isDismissed, isResolved, persistDismissal]);

  useEffect(() => {
    const eligible = isFirstTraceSpotlightDue({
      projectId,
      hasAnyTraces,
      isDismissed,
      guidedPathActive,
      firstTraceSpotlightFired,
    });
    if (!eligible) return;
    if (spotlightsActive || tourActive) {
      // The user is already mid-tour or mid-journey — don't yank them
      // back to the first spotlight. Still mark fired so we don't
      // retry on the next render once they exit.
      markFired();
      return;
    }
    // Brief breath before the spotlight pops up so the user gets to
    // see their first real trace actually land and the page settle.
    // Tapping someone on the shoulder the same frame as their data
    // arrives reads as pushy. 2s is enough to register "oh, my data
    // is here" without dragging.
    const ARRIVAL_BREATH_MS = 2000;
    const timer = setTimeout(startFirstTraceSpotlights, ARRIVAL_BREATH_MS);
    return () => clearTimeout(timer);
  }, [
    projectId,
    hasAnyTraces,
    isDismissed,
    guidedPathActive,
    firstTraceSpotlightFired,
    spotlightsActive,
    tourActive,
    markFired,
    setSpotlightsActive,
    setCurrentSpotlightId,
  ]);
}
