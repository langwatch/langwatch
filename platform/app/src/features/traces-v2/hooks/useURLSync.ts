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
import { useLocation } from "react-router";
import type { TimeRange } from "../stores/filterStore";
import { useFilterStore } from "../stores/filterStore";
import type { LensConfig } from "../stores/viewStore";
import { getPersistedActiveLensId, useViewStore } from "../stores/viewStore";
import { getPresetById } from "@langwatch/trace-web";
import type { BarStateOverrides, FragmentState } from "@langwatch/trace-web";
import {
  buildFragment,
  computeOverrides,
  isOverridesEmpty,
  parseFragment,
} from "@langwatch/trace-web";

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
function canonicalBody(state: BarState): string {
  const overrides = computeOverrides({
    query: state.query,
    timeRange: state.timeRange,
    defaultPresetId: DEFAULT_PRESET_ID,
  });
  if (state.lensId === DEFAULT_LENS_ID && isOverridesEmpty(overrides)) {
    return "";
  }
  return buildFragment(state.lensId, overrides);
}

/**
 * The canonical body of the bar state the store holds right now. Every
 * comparison in this file is target-vs-live, and running both sides through
 * `canonicalBody` is what makes them comparable — a target that had been
 * canonicalised differently (a preset stamped onto an absolute window, say)
 * would never read as equal however unchanged the state was.
 */
function liveBody(state: {
  activeLensId: string;
  queryText: string;
  timeRange: TimeRange;
}): string {
  return canonicalBody({
    lensId: state.activeLensId,
    query: state.queryText,
    timeRange: state.timeRange,
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
 *
 * INSIDE a fragment, an absent preset / from-to pair means the DEFAULT window
 * — not "whatever the store happens to hold". `computeOverrides` omits the
 * preset when it equals the default, so absence there is a positive statement
 * about the state, and reading it as "no opinion" is what let a `popstate`
 * apply half a state: the lens and the pagination moved while the time range
 * stayed on the value the entry had already navigated away from.
 *
 * A URL carrying NO fragment only makes that statement on a `popstate`, where
 * the empty body is exactly what the writer below emits for the default bar
 * state. On the FIRST apply the URL is an arrival address rather than an entry
 * this page wrote — "Observe" in the sidebar is a bare link — so it says
 * nothing about time and the window the user is already on stands. Reading it
 * as the default there silently snapped every in-app arrival back to 30 days
 * and re-queried a window 30x wider than the one the user had chosen.
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
    // Verbatim, and deliberately NOT run past `matchPreset`. The writer emits
    // from/to only for a range the store holds WITHOUT a preset id, so
    // stamping one back on is a lossy round-trip that costs twice: the pinned
    // window starts rolling (`useRollingTimeRange` moves anything carrying a
    // preset id), and this side stops canonicalising to the same body as the
    // live side, so the guard below never reports "in sync" and a Back that
    // only dismissed the drawer throws the user from page 3 to page 1. A
    // window that happens to line up with a preset is still LABELLED as one —
    // `TimeRangePicker` matches for display, which is where that belongs.
    return { from: overrides.timeFrom, to: overrides.timeTo };
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
      // A persisted lens that hasn't hydrated needs no replay of ours —
      // `setUserLenses` restores the stored preference itself. Only a lens the
      // URL named is this hook's to chase.
      pendingLensId: null,
      overrides: {},
    };
  }

  // A fragment naming a lens that hasn't hydrated yet — a reload or a shared
  // `#custom-…` link lands here before `useLensSync` has fetched anything —
  // gets the same treatment as the bare-URL branch above: show the default,
  // but leave the stored preference alone so the real lens can still be
  // restored once it arrives. The id is carried out as `pendingLensId` so the
  // apply can be replayed the moment the list holds it.
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
  // Whether the fragment has been reconciled with the store even once. The
  // very first apply is unconditional — a bare URL on mount still has to
  // restore the last-used lens and start from page 1 — and it is also the
  // only apply that reads the URL as an arrival rather than as a history
  // entry this page wrote (see `resolveTimeRange`).
  //
  // The mount effect is declared ahead of the URL writer, so by the time the
  // writer first runs this is already true; the writer's own check on it is
  // belt-and-braces, holding "never write out a bar state the fragment hasn't
  // had its say on" if the two are ever reordered.
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
    };
  });

  /**
   * A fragment naming a lens the list doesn't hold yet, kept so the apply can
   * be replayed once it does.
   *
   * `useLensSync` fetches custom lenses long after the first apply, so a
   * shared `#custom-…` link necessarily lands before the lens it names exists
   * and the first apply can only show the default. Without this the link is
   * lost twice over: nothing revisits it, and the writer below overwrites the
   * fragment 150ms later, so the address is gone before the lens arrives.
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
    };

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
    // No need to also check that a cursor survived for the current page: the
    // flat list reads by position when `pageCursors[page]` is missing, so the
    // page number stands on its own.
    if (!isFirstApply && targetLens && canonicalBody(applied) === liveBody(live)) {
      return;
    }

    // The apply is TOTAL: every axis the fragment can carry is written from
    // it, so no axis is left holding the value the entry we navigated away
    // from put there. Total is not the same as pristine on the query axis —
    // with no `q` to apply, `selectLens` installs the lens's DRAFT filter
    // where it has one, and drafts are per-lens and persisted, so a filter
    // typed on this lens does come back with it.
    selectLens(target.lensId, { persist: target.persistLens });
    if (target.overrides.query !== undefined) {
      applyQueryText(target.overrides.query);
    }
    if (targetTimeRange) setTimeRange(targetTimeRange);
    resetPagination();

    pendingLens.current = target.pendingLensId
      ? { lensId: target.pendingLensId, lenses: live.allLenses, applied }
      : null;
  }, [selectLens, applyQueryText, setTimeRange, resetPagination]);

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
    if (liveBody(previousState.current) !== canonicalBody(pending.applied)) {
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
  useEffect(() => {
    if (!hasAppliedFragment.current) return;

    const handle = window.setTimeout(() => {
      // Same encoder the popstate guard compares against, so the entry this
      // writes now reads back as "nothing left to apply" — and only this
      // entry: older ones keep whatever body they were written with.
      const body = liveBody({ activeLensId, queryText, timeRange });

      // A fragment naming a lens that hasn't hydrated is a live deep link,
      // not stale state, and collapsing it to what live state spells — for
      // the default fallback, the empty body — is what made a shared
      // `#custom-…` link unopenable: the address was gone 150ms in, long
      // before the lens it named arrived. Hold the URL for as long as the
      // page still shows exactly what that link asked for. The moment
      // anything moves the writer takes back over, so a lens that never
      // hydrates cannot freeze the URL for the rest of the session.
      const pending = pendingLens.current;
      if (pending && body === canonicalBody(pending.applied)) return;

      // Never name a lens the list doesn't hold. The fragment is the shareable
      // address of the view, and an id nothing resolves to just makes the next
      // read fall back to the default — better to leave the previous, still
      // valid, body in place until the lens hydrates.
      if (!allLenses.some((l) => l.id === activeLensId)) return;

      writeFragment(body);
    }, 150);

    return () => window.clearTimeout(handle);
  }, [activeLensId, allLenses, queryText, timeRange]);
}
