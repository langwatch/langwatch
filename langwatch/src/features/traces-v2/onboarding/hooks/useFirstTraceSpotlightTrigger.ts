import { useEffect, useRef } from "react";
import { writeSpotlightFragment } from "../spotlights/SpotlightOverlay";
import { TRACE_EXPLORER_SPOTLIGHTS } from "../spotlights/spotlights";
import { useOnboardingStore } from "../store/onboardingStore";
import { useTraceExplorerTourPreference } from "./useTraceExplorerTourPreference";

interface UseFirstTraceSpotlightTriggerArgs {
  projectId: string | null;
  hasAnyTraces: boolean | undefined;
}

/**
 * One-shot automatic effect: the moment `hasAnyTraces` flips to true in
 * any project where we have not auto-fired the spotlight tour, start the
 * contextual walkthrough of the user's data.
 *
 * The server-backed user preference is the authoritative cross-project,
 * cross-browser dismissal. `firstTraceSpotlightFired` also prevents a
 * duplicate automatic start in the current browser before dismissal. See
 * specs/traces-v2/tour-visibility-and-persistence.feature
 *
 * Skipped silently when:
 *   - the project hasn't been resolved yet (projectId === null)
 *   - hasAnyTraces is still undefined (we don't know yet — don't fire)
 *   - the user already has spotlights running (don't yank them onto
 *     the first spotlight mid-flow)
 *   - the user is mid-legacy-tour (`tourActive` is true) — the legacy
 *     journey is dormant for new users but defensive in case it's
 *     somehow on
 */
export function useFirstTraceSpotlightTrigger({
  projectId,
  hasAnyTraces,
}: UseFirstTraceSpotlightTriggerArgs): void {
  const {
    dismiss: persistDismissal,
    isDismissed,
    isResolved,
  } = useTraceExplorerTourPreference();
  const firstTraceSpotlightFired = useOnboardingStore(
    (s) => s.firstTraceSpotlightFired,
  );
  const seenDrawerSpotlights = useOnboardingStore(
    (s) => s.seenDrawerSpotlights,
  );
  const markFired = useOnboardingStore((s) => s.markFirstTraceSpotlightFired);
  const spotlightsActive = useOnboardingStore((s) => s.spotlightsActive);
  const tourActive = useOnboardingStore((s) => s.tourActive);
  const setSpotlightsActive = useOnboardingStore((s) => s.setSpotlightsActive);
  const setCurrentSpotlightId = useOnboardingStore(
    (s) => s.setCurrentSpotlightId,
  );
  const legacyTourHistoryOnMount = useRef(
    firstTraceSpotlightFired || Object.keys(seenDrawerSpotlights).length > 0,
  ).current;
  const legacyMigrationAttempted = useRef(false);

  useEffect(() => {
    if (
      legacyMigrationAttempted.current ||
      !isResolved ||
      isDismissed ||
      !legacyTourHistoryOnMount
    ) {
      return;
    }
    legacyMigrationAttempted.current = true;
    persistDismissal();
  }, [isDismissed, isResolved, legacyTourHistoryOnMount, persistDismissal]);

  useEffect(() => {
    if (!projectId) return;
    if (hasAnyTraces !== true) return;
    if (isDismissed) return;
    if (firstTraceSpotlightFired) return;
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
    const timer = setTimeout(() => {
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
    }, ARRIVAL_BREATH_MS);
    return () => clearTimeout(timer);
  }, [
    projectId,
    hasAnyTraces,
    isDismissed,
    firstTraceSpotlightFired,
    spotlightsActive,
    tourActive,
    markFired,
    setSpotlightsActive,
    setCurrentSpotlightId,
  ]);
}
