import {
  type TimeRange,
  useFilterStore,
  type LensConfig,
  getPersistedActiveLensId,
  useViewStore,
  type BarStateOverrides,
  type FragmentState,
  buildFragment,
  computeOverrides,
  isOverridesEmpty,
  parseFragment,
} from "@langwatch/trace-browser-kit";
import {
  instantEvalChipsOf,
  instantEvalRunKey,
  queryWithoutInstantEvalChips,
} from "@langwatch/trace-contract";
/**
 * URL fragment synchronization for traces-v2 bar state.
 */
import { type RefObject, useCallback, useEffect, useRef } from "react";
import { useLocation } from "react-router";

import { getPresetById } from "../../../../behavior/time-range-presets.ts";

const DEFAULT_LENS_ID = "all-traces";
const DEFAULT_PRESET_ID = "30d";

/** A fully resolved bar state — every axis concrete, never "leave as is". */
interface BarState {
  lensId: string;
  query: string;
  timeRange: TimeRange;
  /** The Instant Eval runs behind the query's `eval` chips, key to run id. */
  evalRuns: Record<string, string>;
}

const NO_RUNS: Record<string, string> = {};

/**
 * The runs the applied state keeps: those the fragment named, plus any the page
 * holds whose key a chip of the restored query computes to — the key IS the
 * scope, and dropping them would pay for the same judgements twice.
 */
function runsForRestoredQuery({
  named,
  held,
  query,
  lensId,
  timeRange,
}: {
  named: Record<string, string>;
  held: Record<string, string>;
  query: string;
  lensId: string;
  timeRange: TimeRange;
}): Record<string, string> {
  if (!query.trim()) return named;
  const chips = instantEvalChipsOf({ queryText: query, lensId });
  if (chips.length === 0) return named;
  const otherQuery = queryWithoutInstantEvalChips(query);
  const window = {
    from: timeRange.from,
    to: timeRange.to,
    ...(timeRange.presetId ? { presetId: timeRange.presetId } : {}),
  };

  let restored: Record<string, string> | null = null;
  for (const chip of chips) {
    const key = instantEvalRunKey({
      question: chip.question,
      target: chip.target,
      otherQuery,
      window,
    });
    if (named[key] !== undefined) continue;
    const run = held[key];
    if (run === undefined) continue;
    restored ??= { ...named };
    restored[key] = run;
  }

  return restored ?? named;
}

function readFragment(): string {
  if (typeof window === "undefined") return "";
  return window.location.hash;
}

/**
 * Writes the fragment. `asNewEntry` pushes a history entry, so Back returns to
 * the search before it; otherwise the current entry is rewritten in place.
 */
function writeFragment(fragmentBody: string, { asNewEntry }: { asNewEntry: boolean }): void {
  if (typeof window === "undefined") return;
  const newHash = fragmentBody ? `#${fragmentBody}` : "";
  const newURL = `${window.location.pathname}${window.location.search}${newHash}`;
  const currentURL = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  if (newURL === currentURL) return;
  if (asNewEntry) {
    window.history.pushState(null, "", newURL || window.location.pathname);
    return;
  }
  window.history.replaceState(null, "", newURL || window.location.pathname);
}

/**
 * Whether a change of the bar state is a search the reader can come back to:
 * query, window and lens move only on a submit, while run keys ride into the
 * entry that submit made and a mount's first write restates the address.
 */
export function isNewSearchEntry({
  previousSearch,
  nextSearch,
}: {
  /** The body without run keys last seen, or null before the first write. */
  previousSearch: string | null;
  nextSearch: string;
}): boolean {
  return previousSearch !== null && previousSearch !== nextSearch;
}

/**
 * The exact fragment body the write effect below emits for a bar state, including its
 * collapse of "default lens with no overrides" to the empty body.
 */
function canonicalBody(state: BarState): string {
  const overrides = computeOverrides({
    query: state.query,
    timeRange: state.timeRange,
    defaultPresetId: DEFAULT_PRESET_ID,
    // A run is only an address while its query is: with no query there is
    // no chip for it to stand behind.
    ...(state.query ? { runs: state.evalRuns } : {}),
  });
  if (state.lensId === DEFAULT_LENS_ID && isOverridesEmpty(overrides)) {
    return "";
  }
  return buildFragment(state.lensId, overrides);
}

/**
 * The canonical body of the bar state the store holds right now.
 */
function liveBody(state: {
  activeLensId: string;
  queryText: string;
  timeRange: TimeRange;
  evalRuns?: Record<string, string>;
}): string {
  return canonicalBody({
    lensId: state.activeLensId,
    query: state.queryText,
    timeRange: state.timeRange,
    evalRuns: state.evalRuns ?? NO_RUNS,
  });
}

/** The default window, recomputed at read time so it stays anchored to now. */
function defaultTimeRange(): TimeRange | null {
  const preset = getPresetById(DEFAULT_PRESET_ID);
  if (!preset) return null;
  const { from, to } = preset.compute();
  return { from, to, label: preset.label, presetId: preset.id };
}

/**
 * The concrete range a URL denotes, or `null` when it denotes none at all.
 */
function resolveTimeRange({
  parsed,
  isFirstApply,
}: {
  parsed: FragmentState | null;
  isFirstApply: boolean;
}): TimeRange | null {
  if (!parsed) return isFirstApply ? null : defaultTimeRange();

  const overrides = parsed.overrides;
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
    // Verbatim, and deliberately NOT run past `matchPreset`.
    return { from: overrides.timeFrom, to: overrides.timeTo };
  }
  return defaultTimeRange();
}

interface FragmentTarget {
  lensId: string;
  /**
   * Only a lens that actually resolved becomes the new last-used lens. Falling back to
   * the default because the named lens hasn't hydrated yet must NOT be persisted — that
   * would overwrite the very preference `setUserLenses` is waiting to restore.
   */
  persistLens: boolean;
  /**
   * The lens the fragment named when the list doesn't hold it yet, so the
   * apply can be replayed once it does. `null` when the URL named no lens, or
   * when the one it named resolved.
   */
  pendingLensId: string | null;
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
    // Bare URL with no lens fragment. Restore the user's last-used lens instead of
    // snapping to All: a built-in id is shared across projects (so the preference
    // carries cross-project) and is present now.
    const restoredId =
      persistedLensId && allLenses.some((l) => l.id === persistedLensId) ? persistedLensId : null;
    return {
      lensId: restoredId ?? DEFAULT_LENS_ID,
      persistLens: restoredId !== null && restoredId !== DEFAULT_LENS_ID,
      // A persisted lens that hasn't hydrated needs no replay of ours —
      // `setUserLenses` restores the stored preference itself. Only a lens the
      // URL named is this hook's to chase.
      pendingLensId: null,
      overrides: {},
    };
  }

  // A fragment naming a lens that hasn't hydrated yet gets the same treatment as the bare-URL
  // branch above: show the default, but leave the stored preference alone so the real lens can
  // still be restored once it arrives.
  const lensExists = allLenses.some((l) => l.id === parsed.lensId);
  return {
    lensId: lensExists ? parsed.lensId : DEFAULT_LENS_ID,
    persistLens: lensExists,
    pendingLensId: lensExists ? null : parsed.lensId,
    overrides: parsed.overrides,
  };
}

/** The live bar state, as the stores hold it. */
type LiveBarState = {
  activeLensId: string;
  allLenses: LensConfig[];
  draftState: Map<string, { filter?: string }>;
  queryText: string;
  timeRange: TimeRange;
  evalRuns?: Record<string, string>;
};

/** A fragment lens the list does not hold yet, kept so the apply can replay once it does. */
type PendingLens = {
  lensId: string;
  /** The list it was judged against; the replay waits for a different one. */
  lenses: LensConfig[];
  /** The bar state that apply installed; anything else by then is the user's own choice. */
  applied: BarState;
};

/**
 * The bar state an apply leaves behind, in full, which the guards compare
 * against. An absent `q` means the target lens's own filter, which only a
 * hydrated lens supplies; a run rides with the query it was written for.
 */
function appliedStateFor({
  target,
  targetTimeRange,
  live,
}: {
  target: FragmentTarget;
  targetTimeRange: TimeRange | null;
  live: LiveBarState;
}): { targetLens: LensConfig | undefined; applied: BarState } {
  const targetLens = live.allLenses.find((l) => l.id === target.lensId);
  const lensQuery = targetLens
    ? (live.draftState.get(target.lensId)?.filter ?? targetLens.filterText)
    : live.queryText;
  const query = target.overrides.query ?? lensQuery;
  // Null only on the first apply, where the URL states no window and the store's is the answer.
  const timeRange = targetTimeRange ?? live.timeRange;
  const named = target.overrides.query !== undefined ? (target.overrides.runs ?? NO_RUNS) : NO_RUNS;
  return {
    targetLens,
    applied: {
      lensId: target.lensId,
      query,
      timeRange,
      evalRuns: runsForRestoredQuery({
        named,
        held: live.evalRuns ?? NO_RUNS,
        query,
        lensId: target.lensId,
        timeRange,
      }),
    },
  };
}

/**
 * React Router sees same-route fragment pushes but not the store's raw history
 * writes, so every router navigation re-reads the fragment and lets the apply
 * decide. The mount run is skipped; the mount effect already applied it.
 */
function useReapplyOnNavigation({
  hasAppliedFragment,
  applyFromFragment,
}: {
  hasAppliedFragment: RefObject<boolean>;
  applyFromFragment: () => void;
}) {
  const location = useLocation();
  const hasSeenInitialLocation = useRef(false);
  // A ref keeps unstable store actions out of the navigation-only dependency.
  const applyFromFragmentRef = useRef(applyFromFragment);
  useEffect(() => {
    applyFromFragmentRef.current = applyFromFragment;
  });
  useEffect(() => {
    if (!hasAppliedFragment.current) return;
    if (!hasSeenInitialLocation.current) {
      hasSeenInitialLocation.current = true;
      return;
    }
    applyFromFragmentRef.current();
  }, [location.key, hasAppliedFragment]);
}

/**
 * Writes the bar state to the fragment on a 150ms timer, since encoding costs
 * per character. It never names a lens the list lacks, and leaves a pending
 * deep link alone until its lens hydrates.
 */
function useFragmentWriter({
  hasAppliedFragment,
  pendingLens,
  allLenses,
  state,
}: {
  hasAppliedFragment: RefObject<boolean>;
  pendingLens: RefObject<PendingLens | null>;
  allLenses: LensConfig[];
  state: Omit<LiveBarState, "allLenses" | "draftState">;
}) {
  const lastSearchBody = useRef<string | null>(null);
  const { activeLensId, queryText, timeRange, evalRuns } = state;
  useEffect(() => {
    if (!hasAppliedFragment.current) return;
    const handle = window.setTimeout(() => {
      // The popstate guard's own encoder, so this entry reads back as nothing to apply.
      const body = liveBody({ activeLensId, queryText, timeRange, evalRuns });
      const searchBody = liveBody({ activeLensId, queryText, timeRange, evalRuns: NO_RUNS });
      const pending = pendingLens.current;
      if (pending && body === canonicalBody(pending.applied)) return;
      if (!allLenses.some((l) => l.id === activeLensId)) return;
      // A state Back or Forward just restored is already the address; only bookkeeping moves.
      const asNewEntry = isNewSearchEntry({
        previousSearch: lastSearchBody.current,
        nextSearch: searchBody,
      });
      lastSearchBody.current = searchBody;
      writeFragment(body, { asNewEntry });
    }, 150);
    return () => window.clearTimeout(handle);
  }, [hasAppliedFragment, pendingLens, activeLensId, allLenses, queryText, timeRange, evalRuns]);
}

/**
 * The live bar state behind a ref, so the apply (and the popstate listener it
 * feeds) keeps one identity across keystrokes; plus the snapshot one render
 * older, which is the only one that can tell a hydration restore from the user.
 */
function useLiveBarState(state: LiveBarState) {
  const liveState = useRef(state);
  const previousState = useRef(liveState.current);
  useEffect(() => {
    previousState.current = liveState.current;
    liveState.current = state;
  });
  return { liveState, previousState };
}

/**
 * Replays the fragment once the lens list moves under it, which is how a shared
 * `#custom-…` link opens: its lens cannot be loaded at mount. One chance only;
 * a lens, query or window the user chose meanwhile outranks the link.
 */
function usePendingLensReplay({
  pendingLens,
  allLenses,
  previousState,
  applyFromFragment,
}: {
  pendingLens: RefObject<PendingLens | null>;
  allLenses: LensConfig[];
  previousState: RefObject<LiveBarState>;
  applyFromFragment: () => void;
}) {
  useEffect(() => {
    const pending = pendingLens.current;
    if (!pending || pending.lenses === allLenses) return;
    pendingLens.current = null;
    if (!allLenses.some((l) => l.id === pending.lensId)) return;
    // Compared with the render before this one: the last-used-lens restore
    // lands in the same write as the list, and is a fallback, not a choice.
    if (liveBody(previousState.current) !== canonicalBody(pending.applied)) return;
    applyFromFragment();
  }, [allLenses, applyFromFragment, pendingLens, previousState]);
}

/**
 * Hook that synchronizes bar state with the URL fragment.
 * Call once at the page level (TracesPage).
 */
export function useURLSync(): void {
  // Whether the fragment has been reconciled with the store even once.
  const hasAppliedFragment = useRef(false);

  const queryText = useFilterStore((s) => s.queryText);
  const timeRange = useFilterStore((s) => s.timeRange);
  const evalRuns = useFilterStore((s) => s.evalRuns);
  const applyQueryText = useFilterStore((s) => s.applyQueryText);
  const setEvalRuns = useFilterStore((s) => s.setEvalRuns);
  const setTimeRange = useFilterStore((s) => s.setTimeRange);
  const resetPagination = useFilterStore((s) => s.resetPagination);

  const activeLensId = useViewStore((s) => s.activeLensId);
  const allLenses = useViewStore((s) => s.allLenses);
  const draftState = useViewStore((s) => s.draftState);
  const selectLens = useViewStore((s) => s.selectLens);

  const { liveState, previousState } = useLiveBarState({
    activeLensId,
    allLenses,
    draftState,
    queryText,
    timeRange,
    evalRuns,
  });
  const pendingLens = useRef<PendingLens | null>(null);

  const applyFromFragment = useCallback(() => {
    const isFirstApply = !hasAppliedFragment.current;
    hasAppliedFragment.current = true;

    const live = liveState.current;
    const parsed = parseFragment(readFragment());
    const target = resolveTarget({
      parsed,
      allLenses: live.allLenses,
      persistedLensId: getPersistedActiveLensId(),
    });
    const targetTimeRange = resolveTimeRange({ parsed, isFirstApply });
    const { targetLens, applied } = appliedStateFor({ target, targetTimeRange, live });

    // `popstate` fires for every history entry this page owns, and the trace drawer
    // pushes one of its own — its state lives in the query string, which this hook
    // never reads.
    const bodyUnchanged = canonicalBody(applied) === liveBody(live);
    if (!isFirstApply && targetLens && bodyUnchanged) {
      return;
    }

    // The apply is TOTAL: every axis the fragment can carry is written from it, so no
    // axis is left holding the value the entry we navigated away from put there.
    selectLens(target.lensId, { persist: target.persistLens });
    if (target.overrides.query !== undefined) {
      applyQueryText(target.overrides.query);
    }
    setEvalRuns(applied.evalRuns);
    if (targetTimeRange) setTimeRange(targetTimeRange);
    resetPagination();

    pendingLens.current = target.pendingLensId
      ? { lensId: target.pendingLensId, lenses: live.allLenses, applied }
      : null;
  }, [liveState, selectLens, applyQueryText, setEvalRuns, setTimeRange, resetPagination]);

  // Initialize from fragment on mount
  useEffect(() => {
    if (hasAppliedFragment.current) return;
    applyFromFragment();
  }, [applyFromFragment]);

  usePendingLensReplay({ pendingLens, allLenses, previousState, applyFromFragment });

  // Back and forward within the page restore the state their entry carries.
  useEffect(() => {
    if (typeof window === "undefined") return;
    window.addEventListener("popstate", applyFromFragment);
    return () => window.removeEventListener("popstate", applyFromFragment);
  }, [applyFromFragment]);

  useReapplyOnNavigation({ hasAppliedFragment, applyFromFragment });

  useFragmentWriter({
    hasAppliedFragment,
    pendingLens,
    allLenses,
    state: { activeLensId, queryText, timeRange, evalRuns },
  });
}
