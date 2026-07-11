import { useEffect, useMemo } from "react";
import { useInRouterContext, useLocation } from "react-router";
import { useLangy } from "../LangyContext";
import {
  mergeContextChips,
  shortenChipId,
  traceContextChip,
} from "../logic/langyContextChips";
import { useLangyContextTargetStore } from "../stores/langyContextTargetStore";
import {
  type LangyContextChip,
  selectDismissedChips,
  selectVisibleChips,
  useLangyStore,
} from "../stores/langyStore";
import { useLangyDrawerContext } from "./useLangyDrawerContext";
import { useLangyFilterContext } from "./useLangyFilterContext";
import { useLangySelectionContext } from "./useLangySelectionContext";

/**
 * Captures what the user is currently DOING and turns it into composer context
 * chips, so Langy resolves "this trace / these traces / this evaluation"
 * against real state instead of guessing.
 *
 * Sources, most-specific first:
 *   1. The open drawer — the URL-routed drawer (`drawer.open=<name>`) names the
 *      exact resource the user opened (a trace / prompt / evaluation / scenario
 *      drawer). The highest-value signal; see `useLangyDrawerContext`.
 *   2. The route the user is on — `/messages/<trace>`, `/experiments/<slug>`,
 *      `/datasets/<id>` — parsed from the URL. No page edits needed.
 *   3. The Trace Explorer's live table state, when the user is on it: the bulk
 *      row selection ("N traces selected") and the active filter query
 *      ("filtered: <summary>"). Route-gated so their singleton stores can't
 *      leak stale state onto other pages.
 *   4. The experiment the workbench registered via `useRegisterLangyHandlers`.
 *   5. Any precise context a page declared via `useRegisterLangyPageContext`
 *      (a selected prompt / dashboard the URL can't express).
 *   6. Targets the user POINTED AT — the trace rows / evaluation cards / drawer
 *      they clicked while the panel was open (see `useLangyContextTarget`).
 *      Last, so a chip Langy already derived for itself keeps its richer label
 *      and the two collapse into one instead of stacking.
 *
 * Returns the visible chips (undismissed) plus the dismissed candidates that
 * the composer's "+ context" control can add back. A chip stays dismissed only
 * while its underlying context is unchanged; a new id (new trace, new dataset,
 * a changed selection / filter) produces a new chip id and re-surfaces it.
 *
 * Also PUBLISHES the resulting chip ids back to the target store, which is what
 * lets a target on the page know it is already in context and render as added
 * rather than offering itself again.
 */
export function useLangyPageContext(): {
  chips: LangyContextChip[];
  addableChips: LangyContextChip[];
} {
  const { experimentSlug, pageContext } = useLangy();
  // `useLocation` throws outside a <Router>. The panel is always mounted inside
  // the app's router in production, but some unit tests mount it bare — guard
  // with `useInRouterContext` (invariant per mount, so the conditional hook is
  // safe) so those tests don't crash and the panel simply has no route context.
  const inRouter = useInRouterContext();
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const location = inRouter ? useLocation() : undefined;
  const pathname = location?.pathname ?? "";
  const search = location?.search ?? "";
  const dismissed = useLangyStore((s) => s.dismissedChipIds);

  // Sub-hooks subscribe to their own sources (the drawer URL param, the Trace
  // Explorer selection/filter stores). They're always called (rules of hooks);
  // the route-gating for the trace-table chips happens when we compose below.
  const drawerChips = useLangyDrawerContext(search);
  const selectionChip = useLangySelectionContext();
  const filterChip = useLangyFilterContext();

  // Things the user pointed at on the page. Full chip copies, so a picked trace
  // row that has since scrolled out of the virtualized table keeps its chip.
  const pickedChips = useLangyContextTargetStore((s) => s.picked);
  const setActiveChipIds = useLangyContextTargetStore(
    (s) => s.setActiveChipIds,
  );

  // The Trace Explorer lives at `/:project/traces`. Its selection + filter
  // stores are module singletons that survive navigation, so only surface
  // their chips while the user is actually on that surface.
  const onTraceExplorer = surfaceOf(pathname) === "traces";

  const candidates = useMemo<LangyContextChip[]>(
    () =>
      // Most-specific first; `mergeContextChips` keeps the first claim on an id.
      // Deliberately NO project chip. Langy always operates in the current
      // project, so pinning "project: X" as context is noise — it tells the user
      // nothing they don't already know and crowds the composer. Context chips
      // only earn their place when they name a SPECIFIC resource the user is
      // looking at (an experiment, a trace, a dataset) that the agent should
      // resolve "this" against.
      mergeContextChips([
        // Open drawer first — the most specific "what am I looking at" signal.
        ...drawerChips,
        ...routeChips(pathname),
        onTraceExplorer ? selectionChip : null,
        onTraceExplorer ? filterChip : null,
        experimentSlug
          ? {
              id: `experiment:${experimentSlug}`,
              kind: "experiment",
              label: `experiment: ${experimentSlug}`,
              ref: experimentSlug,
            }
          : null,
        ...pageContext,
        ...pickedChips,
      ]),
    [
      drawerChips,
      pathname,
      onTraceExplorer,
      selectionChip,
      filterChip,
      experimentSlug,
      pageContext,
      pickedChips,
    ],
  );

  const chips = useMemo(
    () => selectVisibleChips(candidates, dismissed),
    [candidates, dismissed],
  );

  // Tell the page which chips are live, so a registered target can render as
  // "already in context". `setActiveChipIds` no-ops when the membership is
  // unchanged, so re-running this on an unrelated render wakes nobody.
  useEffect(() => {
    setActiveChipIds(chips.map((chip) => chip.id));
  }, [chips, setActiveChipIds]);

  return {
    chips,
    addableChips: selectDismissedChips(candidates, dismissed),
  };
}

/** The surface segment of a `/<projectSlug>/<surface>/…` path (or ""). */
function surfaceOf(pathname: string): string {
  return pathname.split("/").filter((s) => s.length > 0)[1] ?? "";
}

/**
 * Derive resource chips from the pathname. Paths look like
 * `/<projectSlug>/<surface>/<...rest>`; only the dynamic-id routes yield a
 * resource chip (index pages have no specific resource to pin).
 */
function routeChips(pathname: string): LangyContextChip[] {
  const segments = pathname.split("/").filter((s) => s.length > 0);
  // [projectSlug, surface, ...rest]
  const surface = segments[1];
  const rest = segments.slice(2);
  if (!surface || rest.length === 0) return [];

  switch (surface) {
    case "messages":
      // Shared with the trace rows / trace drawer that register themselves as
      // context targets, so a clicked trace and a routed one are the same chip.
      return [traceContextChip(rest[0]!)];
    case "experiments": {
      // `/experiments/<slug>` or `/experiments/workbench/<slug>`.
      const slug = rest[0] === "workbench" ? rest[1] : rest[0];
      if (!slug || slug === "index") return [];
      return [
        {
          id: `experiment:${slug}`,
          kind: "experiment",
          label: `experiment: ${slug}`,
          ref: slug,
        },
      ];
    }
    case "datasets": {
      const id = rest[0]!;
      return [
        {
          id: `dataset:${id}`,
          kind: "dataset",
          label: `dataset ${shortenChipId(id)}`,
          ref: id,
        },
      ];
    }
    default:
      return [];
  }
}
