import { useEffect } from "react";
import { writeSpotlightFragment } from "../spotlights/SpotlightOverlay";
import { TRACE_EXPLORER_SPOTLIGHTS } from "../spotlights/spotlights";
import { useOnboardingStore } from "../store/onboardingStore";

interface UseFirstTraceSpotlightTriggerArgs {
  projectId: string | null;
  hasAnyTraces: boolean | undefined;
}

/**
 * One-shot per-project effect: the moment `hasAnyTraces` flips to true
 * for a project we haven't auto-fired the spotlight tour on yet, start
 * spotlights so the user gets a contextual walk-through of their own
 * data the instant it lands.
 *
 * Persisted in `firstTraceSpotlightFiredByProject` so refreshes don't
 * re-trigger, and a second project gets its own first-trace moment
 * (we'd add a cross-project / cross-user "has the user ever finished
 * one of these" signal here later when the backend lands one).
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
  const firstTraceSpotlightFiredByProject = useOnboardingStore(
    (s) => s.firstTraceSpotlightFiredByProject,
  );
  const markFired = useOnboardingStore((s) => s.markFirstTraceSpotlightFired);
  const spotlightsActive = useOnboardingStore((s) => s.spotlightsActive);
  const tourActive = useOnboardingStore((s) => s.tourActive);
  const setSpotlightsActive = useOnboardingStore((s) => s.setSpotlightsActive);
  const setCurrentSpotlightId = useOnboardingStore(
    (s) => s.setCurrentSpotlightId,
  );

  useEffect(() => {
    if (!projectId) return;
    if (hasAnyTraces !== true) return;
    if (firstTraceSpotlightFiredByProject[projectId]) return;
    if (spotlightsActive || tourActive) {
      // The user is already mid-tour or mid-journey — don't yank them
      // back to the first spotlight. Still mark fired so we don't
      // retry on the next render once they exit.
      markFired(projectId);
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
        state.markFirstTraceSpotlightFired(projectId);
        return;
      }
      const first = TRACE_EXPLORER_SPOTLIGHTS[0];
      const firstId = first?.id ?? null;
      state.setCurrentSpotlightId(firstId);
      state.setSpotlightsActive(true);
      writeSpotlightFragment(firstId);
      state.markFirstTraceSpotlightFired(projectId);
    }, ARRIVAL_BREATH_MS);
    return () => clearTimeout(timer);
  }, [
    projectId,
    hasAnyTraces,
    firstTraceSpotlightFiredByProject,
    spotlightsActive,
    tourActive,
    markFired,
    setSpotlightsActive,
    setCurrentSpotlightId,
  ]);
}
