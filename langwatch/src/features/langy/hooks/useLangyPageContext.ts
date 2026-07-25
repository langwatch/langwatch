import { useEffect, useMemo } from "react";
import { useInRouterContext, useLocation } from "react-router";
import { useLangy } from "../LangyContext";
import {
  datasetContextChip,
  mergeContextChips,
  traceContextChip,
} from "../logic/langyContextChips";
import { useLangyContextTargetStore } from "../stores/langyContextTargetStore";
import {
  type LangyContextChip,
  selectAddableChips,
  selectVisibleChips,
  useLangyStore,
} from "../stores/langyStore";
import { useLangyDrawerContext } from "./useLangyDrawerContext";
import { useLangySelectionContext } from "./useLangySelectionContext";
import { useLangyTraceViewContext } from "./useLangyTraceViewContext";

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
 * Everything above is an OFFER, not context. `chips` is the subset the user has
 * actually chosen — by arming the page and clicking a target, or from the
 * composer's "+ context" control, which is what `addableChips` fills. Merely
 * being on a page, or having a drawer open, adds nothing: the agent is handed
 * what someone decided to hand it, and the chips in the composer are the whole
 * truth about what that is.
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
  const chosen = useLangyStore((s) => s.chosenChipIds);

  // Sub-hooks subscribe to their own sources (the drawer URL param, the Trace
  // Explorer selection/filter stores). They're always called (rules of hooks);
  // the route-gating for the trace-table chips happens when we compose below.
  const drawerChips = useLangyDrawerContext(search);
  const selectionChip = useLangySelectionContext();
  const traceViewChip = useLangyTraceViewContext();

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
        // Always include the whole view. This carries the time range as well as
        // the search, so "these traces" is meaningful even before any row is
        // opened or selected.
        onTraceExplorer ? traceViewChip : null,
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
      traceViewChip,
      experimentSlug,
      pageContext,
      pickedChips,
    ],
  );

  const chips = useMemo(
    () => selectVisibleChips(candidates, chosen),
    [candidates, chosen],
  );

  // Tell the page which chips are live, so a registered target can render as
  // "already in context". `setActiveChipIds` no-ops when the membership is
  // unchanged, so re-running this on an unrelated render wakes nobody.
  useEffect(() => {
    setActiveChipIds(chips.map((chip) => chip.id));
  }, [chips, setActiveChipIds]);

  return {
    chips,
    addableChips: selectAddableChips(candidates, chosen),
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
    case "datasets":
      // Shared with the dataset list rows that register as context targets, so
      // a clicked dataset and a routed one are the same chip.
      return [datasetContextChip({ datasetId: rest[0]! })];
    default: {
      const spec = SIMPLE_ROUTE_CHIPS[surface];
      if (!spec) return [];
      const ref = rest[0]!;
      // Index-ish tails (`/prompts/new`) name no resource — offering "prompt:
      // new" as context would be a chip that resolves to nothing.
      if (RESOURCELESS_TAILS.has(ref)) return [];
      return [
        { id: `${spec.kind}:${ref}`, kind: spec.kind, label: `${spec.noun} ${ref}`, ref },
      ];
    }
  }
}

/**
 * Surfaces whose `/<surface>/<id>` route names exactly one resource, so the
 * chip is a mechanical `kind:id`. The ones with shapes of their own — traces,
 * experiments (`/workbench/<slug>`), datasets — are handled above.
 *
 * This is the list of things Langy can be pointed at, and it is meant to grow:
 * a resource the agent can act on but that never appears here is a resource the
 * user has to describe in prose instead of naming.
 */
const SIMPLE_ROUTE_CHIPS: Record<
  string,
  { kind: LangyContextChip["kind"]; noun: string }
> = {
  prompts: { kind: "prompt", noun: "prompt" },
  evaluations: { kind: "evaluation", noun: "evaluation" },
  evaluators: { kind: "evaluation", noun: "evaluator" },
  "online-evaluations": { kind: "evaluation", noun: "evaluation" },
  simulations: { kind: "scenario", noun: "simulation" },
  workflows: { kind: "workflow", noun: "workflow" },
  studio: { kind: "workflow", noun: "workflow" },
  agents: { kind: "agent", noun: "agent" },
  automations: { kind: "automation", noun: "automation" },
  annotations: { kind: "annotation", noun: "annotation" },
};

/** Tails that are a page, not a resource. */
const RESOURCELESS_TAILS = new Set(["new", "index", "create"]);
