/**
 * URL fragment synchronization for traces-v2 bar state.
 *
 * The bar state (active lens + query + timeRange) is encoded into the URL
 * fragment so it survives refresh and is shareable. Pagination is NOT: the
 * cursors are keyset and deliberately session-local, because a deep batch is
 * not a stable shareable address. When the in-memory state matches a built-in
 * lens exactly, the fragment collapses to just `#<lensId>`. Deep-link query
 * params (trace, span, viz, mode) are intentionally left untouched — which is
 * why a fragment that denotes the state the store already holds means the bar
 * hasn't changed, however much the query string moved underneath it.
 */
import { useCallback, useEffect, useRef } from "react";
import type { TimeRange } from "../stores/filterStore";
import { useFilterStore } from "../stores/filterStore";
import type { LensConfig } from "../stores/viewStore";
import { getPersistedActiveLensId, useViewStore } from "../stores/viewStore";
import { getPresetById, matchPreset } from "../utils/timeRangePresets";
import type { BarStateOverrides, FragmentState } from "../utils/urlState";
import {
  buildFragment,
  computeOverrides,
  isOverridesEmpty,
  parseFragment,
} from "../utils/urlState";

const DEFAULT_LENS_ID = "all-traces";
const DEFAULT_PRESET_ID = "30d";

/** A fully resolved bar state — every axis concrete, never "leave as is". */
interface BarState {
  lensId: string;
  query: string;
  timeRange: TimeRange;
}

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
 * The exact fragment body the write effect below emits for a bar state,
 * including its collapse of "default lens with no overrides" to the empty
 * body. Both the writer and the popstate guard go through this, so two bar
 * states are the same state iff their canonical bodies match — by
 * construction, rather than by two encodings kept in step by hand.
 */
function canonicalBody(state: BarState, lens: LensConfig): string {
  const overrides = computeOverrides({
    activeLens: lens,
    query: state.query,
    timeRange: state.timeRange,
    defaultPresetId: DEFAULT_PRESET_ID,
  });
  if (state.lensId === DEFAULT_LENS_ID && isOverridesEmpty(overrides)) {
    return "";
  }
  return buildFragment(state.lensId, overrides);
}

/** The default window, recomputed at read time so it stays anchored to now. */
function defaultTimeRange(): TimeRange | null {
  const preset = getPresetById(DEFAULT_PRESET_ID);
  if (!preset) return null;
  const { from, to } = preset.compute();
  return { from, to, label: preset.label, presetId: preset.id };
}

/**
 * The concrete range a fragment's overrides denote.
 *
 * An absent preset / from-to pair means the DEFAULT window — not "whatever the
 * store happens to hold". `computeOverrides` omits the preset when it equals
 * the default, so absence is a positive statement about the state, and reading
 * it as "no opinion" is what let a `popstate` apply half a state: the lens and
 * the pagination moved while the time range stayed on the value the entry had
 * already navigated away from.
 */
function resolveTimeRange(overrides: BarStateOverrides): TimeRange | null {
  if (overrides.preset !== undefined) {
    const preset = getPresetById(overrides.preset);
    if (preset) {
      const { from, to } = preset.compute();
      return { from, to, label: preset.label, presetId: preset.id };
    }
    // Unknown preset id (hand-edited, or written by a newer build) — the
    // default window is still a better answer than silently keeping whatever
    // the previous entry left behind.
    return defaultTimeRange();
  }
  if (overrides.timeFrom !== undefined && overrides.timeTo !== undefined) {
    const range = { from: overrides.timeFrom, to: overrides.timeTo };
    const preset = matchPreset(range);
    return preset
      ? { ...range, label: preset.label, presetId: preset.id }
      : range;
  }
  return defaultTimeRange();
}

interface FragmentTarget {
  lensId: string;
  /**
   * Only a lens that actually resolved becomes the new last-used lens.
   * Falling back to the default because the named lens hasn't hydrated yet
   * must NOT be persisted — that would overwrite the very preference
   * `setUserLenses` is waiting to restore.
   */
  persistLens: boolean;
  overrides: BarStateOverrides;
}

function resolveTarget({
  parsed,
  allLenses,
  persistedLensId,
}: {
  parsed: FragmentState | null;
  allLenses: LensConfig[];
  persistedLensId: string | null;
}): FragmentTarget {
  if (!parsed) {
    // Bare URL with no lens fragment. Restore the user's last-used lens
    // instead of snapping to All: a built-in id is shared across projects
    // (so the preference carries cross-project) and is present now. A
    // persisted CUSTOM lens may not have hydrated yet — if it isn't in the
    // list, fall back to the default WITHOUT persisting, so setUserLenses
    // can still restore it once it arrives (see viewStore).
    const restoredId =
      persistedLensId && allLenses.some((l) => l.id === persistedLensId)
        ? persistedLensId
        : null;
    return {
      lensId: restoredId ?? DEFAULT_LENS_ID,
      persistLens: restoredId !== null && restoredId !== DEFAULT_LENS_ID,
      overrides: {},
    };
  }

  // A fragment naming a lens that hasn't hydrated yet — a reload or a shared
  // `#custom-…` link lands here before `useLensSync` has fetched anything —
  // gets the same treatment as the bare-URL branch above: show the default,
  // but leave the stored preference alone so the real lens can still be
  // restored once it arrives.
  const lensExists = allLenses.some((l) => l.id === parsed.lensId);
  return {
    lensId: lensExists ? parsed.lensId : DEFAULT_LENS_ID,
    persistLens: lensExists,
    overrides: parsed.overrides,
  };
}

/**
 * Hook that synchronizes bar state with the URL fragment.
 * Call once at the page level (TracesPage).
 */
export function useURLSync(): void {
  // Whether the fragment has been reconciled with the store even once. The
  // very first apply is unconditional — a bare URL on mount still has to
  // restore the last-used lens and start from page 1 — and the URL writer
  // stays quiet until it has happened, so it can never write out a bar state
  // the fragment hasn't had its say on.
  const hasAppliedFragment = useRef(false);

  const queryText = useFilterStore((s) => s.queryText);
  const timeRange = useFilterStore((s) => s.timeRange);
  const applyQueryText = useFilterStore((s) => s.applyQueryText);
  const setTimeRange = useFilterStore((s) => s.setTimeRange);
  const resetPagination = useFilterStore((s) => s.resetPagination);

  const activeLensId = useViewStore((s) => s.activeLensId);
  const allLenses = useViewStore((s) => s.allLenses);
  const draftState = useViewStore((s) => s.draftState);
  const selectLens = useViewStore((s) => s.selectLens);

  // Live bar state behind a ref so `applyFromFragment` — and therefore the
  // `popstate` listener it feeds — keeps one identity instead of being torn
  // down and re-registered on every keystroke. Declared before the effects
  // that call it, so React has already written it by the time they run.
  const liveState = useRef({
    activeLensId,
    allLenses,
    draftState,
    queryText,
    timeRange,
  });
  useEffect(() => {
    liveState.current = {
      activeLensId,
      allLenses,
      draftState,
      queryText,
      timeRange,
    };
  });

  const applyFromFragment = useCallback(() => {
    const isFirstApply = !hasAppliedFragment.current;
    hasAppliedFragment.current = true;

    const live = liveState.current;
    const target = resolveTarget({
      parsed: parseFragment(readFragment()),
      allLenses: live.allLenses,
      persistedLensId: getPersistedActiveLensId(),
    });
    const targetTimeRange = resolveTimeRange(target.overrides);
    const targetLens = live.allLenses.find((l) => l.id === target.lensId);
    const activeLens = live.allLenses.find((l) => l.id === live.activeLensId);

    // `popstate` fires for every history entry this page owns, and the trace
    // drawer pushes one of its own — its state lives in the query string,
    // which this hook never reads. So dismissing the drawer with browser Back
    // (the documented close gesture) lands here on an entry denoting exactly
    // the bar state the store already holds. Re-applying it would achieve
    // nothing except wiping the keyset cursors and throwing the user from
    // page 3 back to page 1.
    //
    // The comparison is on the DECODED state, not the raw body: only the
    // newest entry is ever rewritten by the write effect, so an older entry's
    // string routinely lags the state it denotes, and several bodies denote
    // the same state anyway (`""` and `"all-traces"`; two orderings of the
    // same params). Comparing strings made the drawer's own entry look like a
    // real navigation.
    //
    // No need to also check that a cursor survived for the current page —
    // `useTraceListQuery` already snaps back to page 1 whenever
    // `pageCursors[page]` is missing, which is the same guard one layer down.
    if (!isFirstApply && targetLens && activeLens && targetTimeRange) {
      const draft = live.draftState.get(target.lensId);
      // An absent `q` denotes the target lens's own filter — the value
      // `selectLens` installs below — not "keep the current query".
      const targetQuery =
        target.overrides.query ?? draft?.filter ?? targetLens.filterText;
      const alreadyInSync =
        canonicalBody(
          {
            lensId: target.lensId,
            query: targetQuery,
            timeRange: targetTimeRange,
          },
          targetLens,
        ) ===
        canonicalBody(
          {
            lensId: live.activeLensId,
            query: live.queryText,
            timeRange: live.timeRange,
          },
          activeLens,
        );
      if (alreadyInSync) return;
    }

    // The apply is TOTAL: every axis the fragment can carry is written from
    // it, so nothing of the entry we navigated away from survives. The query
    // axis is total via `selectLens`, which re-installs the lens's own filter
    // text (or its draft) before any `q` override lands on top.
    selectLens(target.lensId, { persist: target.persistLens });
    if (target.overrides.query !== undefined) {
      applyQueryText(target.overrides.query);
    }
    if (targetTimeRange) setTimeRange(targetTimeRange);
    resetPagination();
  }, [selectLens, applyQueryText, setTimeRange, resetPagination]);

  // Initialize from fragment on mount
  useEffect(() => {
    if (hasAppliedFragment.current) return;
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
    if (!hasAppliedFragment.current) return;

    const handle = window.setTimeout(() => {
      const activeLens = allLenses.find((l) => l.id === activeLensId);
      if (!activeLens) return;

      // Same encoder the popstate guard compares against, so this entry now
      // reads back as "nothing left to apply" — and only this entry: older
      // ones keep whatever body they were written with.
      writeFragment(
        canonicalBody(
          { lensId: activeLensId, query: queryText, timeRange },
          activeLens,
        ),
      );
    }, 150);

    return () => window.clearTimeout(handle);
  }, [activeLensId, allLenses, queryText, timeRange]);
}
