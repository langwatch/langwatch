/**
 * URL fragment synchronization for traces-v2 bar state.
 *
 * The bar state (active lens + query + timeRange + page) is encoded into the
 * URL fragment so it survives refresh and is shareable. Cursor pagination is
 * deliberately session-local: a deep batch is not a stable shareable address.
 * When the in-memory
 * state matches a built-in lens exactly, the fragment collapses to just
 * `#<lensId>`. Deep-link query params (trace, span, viz, mode) are
 * intentionally left untouched.
 */
import { useCallback, useEffect, useRef } from "react";
import { useFilterStore } from "../stores/filterStore";
import { getPersistedActiveLensId, useViewStore } from "../stores/viewStore";
import { getPresetById, matchPreset } from "../utils/timeRangePresets";
import {
  buildFragment,
  computeOverrides,
  isOverridesEmpty,
  parseFragment,
} from "../utils/urlState";

const DEFAULT_LENS_ID = "all-traces";
const DEFAULT_PRESET_ID = "30d";

function readFragment(): string {
  if (typeof window === "undefined") return "";
  return window.location.hash;
}

function writeFragment(fragmentBody: string): void {
  if (typeof window === "undefined") return;
  const newHash = fragmentBody ? `#${fragmentBody}` : "";
  const newURL = `${window.location.pathname}${window.location.search}${newHash}`;
  const currentURL = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  if (newURL === currentURL) return;
  window.history.replaceState(null, "", newURL || window.location.pathname);
}

/**
 * Hook that synchronizes bar state with the URL fragment.
 * Call once at the page level (TracesPage).
 */
export function useURLSync(): void {
  const isInitialized = useRef(false);

  const queryText = useFilterStore((s) => s.queryText);
  const timeRange = useFilterStore((s) => s.timeRange);
  const applyQueryText = useFilterStore((s) => s.applyQueryText);
  const setTimeRange = useFilterStore((s) => s.setTimeRange);
  const resetPagination = useFilterStore((s) => s.resetPagination);

  const activeLensId = useViewStore((s) => s.activeLensId);
  const allLenses = useViewStore((s) => s.allLenses);
  const selectLens = useViewStore((s) => s.selectLens);

  const applyFromFragment = useCallback(() => {
    const parsed = parseFragment(readFragment());
    if (!parsed) {
      // Bare URL with no lens fragment. Restore the user's last-used lens
      // instead of snapping to All: a built-in id is shared across projects
      // (so the preference carries cross-project) and is present now. A
      // persisted CUSTOM lens may not have hydrated yet — if it isn't in the
      // list, fall back to the default WITHOUT persisting, so setUserLenses
      // can still restore it once it arrives (see viewStore).
      const persisted = getPersistedActiveLensId();
      const restoreId =
        persisted && allLenses.some((l) => l.id === persisted)
          ? persisted
          : DEFAULT_LENS_ID;
      selectLens(restoreId, { persist: restoreId !== DEFAULT_LENS_ID });
      resetPagination();
      return;
    }

    const lensExists = allLenses.some((l) => l.id === parsed.lensId);
    const targetLensId = lensExists ? parsed.lensId : DEFAULT_LENS_ID;
    selectLens(targetLensId);

    const { overrides } = parsed;
    if (overrides.query !== undefined) applyQueryText(overrides.query);
    if (overrides.preset !== undefined) {
      const preset = getPresetById(overrides.preset);
      if (preset) {
        const { from, to } = preset.compute();
        setTimeRange({ from, to, label: preset.label, presetId: preset.id });
      }
    } else if (
      overrides.timeFrom !== undefined &&
      overrides.timeTo !== undefined
    ) {
      const range = { from: overrides.timeFrom, to: overrides.timeTo };
      const preset = matchPreset(range);
      setTimeRange(
        preset ? { ...range, label: preset.label, presetId: preset.id } : range,
      );
    }
    resetPagination();
  }, [allLenses, selectLens, applyQueryText, setTimeRange, resetPagination]);

  // Initialize from fragment on mount
  useEffect(() => {
    if (isInitialized.current) return;
    isInitialized.current = true;
    applyFromFragment();
  }, [applyFromFragment]);

  // Restore state on browser back/forward navigation within the page.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onPopState = () => applyFromFragment();
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [applyFromFragment]);

  // Coalesce URL writes on a 150ms timer. `replaceState` itself is cheap,
  // but `computeOverrides`/`buildFragment` allocate per char, and effect
  // re-runs on every keystroke add up. 150ms is below human perception of
  // URL trailing the editor.
  useEffect(() => {
    if (!isInitialized.current) return;

    const handle = window.setTimeout(() => {
      const activeLens = allLenses.find((l) => l.id === activeLensId);
      if (!activeLens) return;

      const overrides = computeOverrides({
        activeLens,
        query: queryText,
        timeRange,
        defaultPresetId: DEFAULT_PRESET_ID,
      });

      if (activeLensId === DEFAULT_LENS_ID && isOverridesEmpty(overrides)) {
        writeFragment("");
        return;
      }
      writeFragment(buildFragment(activeLensId, overrides));
    }, 150);

    return () => window.clearTimeout(handle);
  }, [activeLensId, allLenses, queryText, timeRange]);
}
