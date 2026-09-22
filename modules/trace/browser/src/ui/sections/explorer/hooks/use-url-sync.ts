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
import { useCallback, useEffect, useRef } from "react";
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
    evalRuns,
  });
  // The same snapshot, one render older. `setUserLenses` restores the
  // last-used lens in the very store write that hydrates the list, so by the
  // first render that sees the new list the active lens may already have moved
  // without the user touching anything. "Had the user gone somewhere else?"
  // is therefore only answerable from the render BEFORE that one.
  const previousState = useRef(liveState.current);
  useEffect(() => {
    previousState.current = liveState.current;
    liveState.current = {
      activeLensId,
      allLenses,
      draftState,
      queryText,
      timeRange,
      evalRuns,
    };
  });

  /**
   * A fragment naming a lens the list doesn't hold yet, kept so the apply can be
   * replayed once it does.
   */
  const pendingLens = useRef<{
    lensId: string;
    /** The list it was judged against; the replay waits for a different one. */
    lenses: LensConfig[];
    /**
     * The bar state that apply installed. Anything else in the store by the
     * time the list moves means the user chose for themselves while we waited,
     * and their choice outranks the link.
     */
    applied: BarState;
  } | null>(null);

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
    const targetLens = live.allLenses.find((l) => l.id === target.lensId);
    // An absent `q` denotes the target lens's own filter — the value
    // `selectLens` installs below — not "keep the current query". Only a lens
    // that has actually hydrated can supply it, which is why the guard below
    // waits for one.
    const lensQuery = targetLens
      ? (live.draftState.get(target.lensId)?.filter ?? targetLens.filterText)
      : live.queryText;

    /**
     * The bar state this apply leaves behind, in full: what the guard below
     * compares the store against, and what the replay effect later compares
     * the store against to tell "nobody touched it" from "the user moved on".
     */
    const applied: BarState = {
      lensId: target.lensId,
      query: target.overrides.query ?? lensQuery,
      // Null only on the first apply, where the URL carries no time-range
      // statement at all and the window the store holds is the answer.
      timeRange: targetTimeRange ?? live.timeRange,
      // A run rides with the query it was written for; what the fragment does
      // not name is recovered by key from the runs the page already holds.
      evalRuns: runsForRestoredQuery({
        named: target.overrides.query !== undefined ? (target.overrides.runs ?? NO_RUNS) : NO_RUNS,
        held: live.evalRuns ?? NO_RUNS,
        query: target.overrides.query ?? lensQuery,
        lensId: target.lensId,
        timeRange: targetTimeRange ?? live.timeRange,
      }),
    };

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
  }, [selectLens, applyQueryText, setEvalRuns, setTimeRange, resetPagination]);

  // Initialize from fragment on mount
  useEffect(() => {
    if (hasAppliedFragment.current) return;
    applyFromFragment();
  }, [applyFromFragment]);

  // Replay the fragment once the lens list moves under it — the other half of
  // honouring a shared `#custom-…` link, whose lens cannot possibly be loaded
  // at mount. Nothing else revisits the fragment: `applyFromFragment` doesn't
  // depend on the lens list, and the mount effect above is one-shot.
  useEffect(() => {
    const pending = pendingLens.current;
    // Still the list the apply was judged against: nothing has hydrated, so
    // there is nothing new to say about the lens it named.
    if (!pending || pending.lenses === allLenses) return;
    // Whatever happens next, this was the one chance. Either the lens has
    // arrived, or it never existed here at all — deleted by a teammate, or
    // another project's id — and the writer below takes the URL back.
    pendingLens.current = null;
    if (!allLenses.some((l) => l.id === pending.lensId)) return;
    // A lens the user picked, a query they typed or a window they moved while
    // the list loaded outranks the link. The comparison is against the render
    // BEFORE this one because `setUserLenses` restores the last-used lens in
    // the same write that hydrates the list, and that restore is a fallback
    // preference, not the user choosing anything — the URL outranks it.
    const bodyMoved = liveBody(previousState.current) !== canonicalBody(pending.applied);
    if (bodyMoved) {
      return;
    }
    applyFromFragment();
  }, [allLenses, applyFromFragment]);

  // Restore state on browser back/forward navigation within the page.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onPopState = () => applyFromFragment();
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [applyFromFragment]);

  // React Router observes same-route fragment pushes but not the raw history
  // writes used by the store. Re-read the live fragment for every router
  // navigation and let `applyFromFragment` decide whether it is already in
  // sync. Skip the mount run because the mount effect has already applied it.
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
  }, [location.key]);

  // Coalesce URL writes on a 150ms timer. `replaceState` itself is cheap,
  // but `computeOverrides`/`buildFragment` allocate per char, and effect
  // re-runs on every keystroke add up. 150ms is below human perception of
  // URL trailing the editor.
  const lastSearchBody = useRef<string | null>(null);
  useEffect(() => {
    if (!hasAppliedFragment.current) return;

    const handle = window.setTimeout(() => {
      // Same encoder the popstate guard compares against, so the entry this
      // writes now reads back as "nothing left to apply" — and only this
      // entry: older ones keep whatever body they were written with.
      const body = liveBody({ activeLensId, queryText, timeRange, evalRuns });
      const searchBody = liveBody({
        activeLensId,
        queryText,
        timeRange,
        evalRuns: NO_RUNS,
      });

      // A fragment naming a lens that hasn't hydrated is a live deep link, not stale state.
      // Collapsing it to the default fallback's empty body made a shared `#custom-…` link
      // unopenable, gone before the lens it named arrived.
      const pending = pendingLens.current;
      if (pending && body === canonicalBody(pending.applied)) return;

      // Never name a lens the list doesn't hold. The fragment is the shareable
      // address of the view, and an id nothing resolves to just makes the next
      // read fall back to the default — better to leave the previous, still
      // valid, body in place until the lens hydrates.
      if (!allLenses.some((l) => l.id === activeLensId)) return;

      // A state Back or Forward just restored already is the address, so the
      // write below is a no-op for it and only the bookkeeping moves.
      const asNewEntry = isNewSearchEntry({
        previousSearch: lastSearchBody.current,
        nextSearch: searchBody,
      });
      lastSearchBody.current = searchBody;
      writeFragment(body, { asNewEntry });
    }, 150);

    return () => window.clearTimeout(handle);
  }, [activeLensId, allLenses, queryText, timeRange, evalRuns]);
}
