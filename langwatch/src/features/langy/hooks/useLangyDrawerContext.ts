import { useMemo } from "react";
import type { LangyContextChip } from "../stores/langyStore";

/**
 * Derives a page-context chip from the app's URL-routed drawer (task: richer
 * Langy context). Drawers serialize as `drawer.open=<name>` plus flat
 * `drawer.<param>` query params (see `dev/docs/best_practices/drawers.md` and
 * `useDrawer`), so when a drawer is open the URL already names the exact
 * resource the user is looking at — the highest-value "what am I doing" signal
 * Langy can pick up without any page-level registration.
 *
 * This reads the drawer straight off the query string (the same source
 * `drawerStore.readInitialFromURL` reads) and maps the drawer name → a chip
 * kind + the param that carries its resource id. Only drawers whose id lands in
 * the URL as a flat scalar are mapped; drawers that carry their target in a
 * nested / in-memory prop (e.g. the dataset editor's `datasetToSave` object,
 * the automation drawer's complex props) are deliberately skipped rather than
 * guessed — see the TODO below.
 */
export function useLangyDrawerContext(search: string): LangyContextChip[] {
  return useMemo(() => drawerContextChips(search), [search]);
}

/**
 * How a drawer name maps to a context chip: which flat `drawer.<param>` carries
 * its resource id, what chip kind it becomes, and how the label reads. Kinds
 * reuse the existing resource vocabulary (`trace` / `prompt` / `scenario`) so a
 * drawer-derived chip dedups against the same route-derived chip, plus the new
 * `evaluation` kind for evaluator / monitor drawers.
 */
const DRAWER_CHIP_SPECS: Record<
  string,
  { param: string; kind: LangyContextChip["kind"]; noun: string }
> = {
  // Trace detail — both the Traces V2 explorer drawer and the legacy drawer
  // put the id in `drawer.traceId`.
  traceV2Details: { param: "traceId", kind: "trace", noun: "trace" },
  traceDetails: { param: "traceId", kind: "trace", noun: "trace" },
  // Prompt editor.
  promptEditor: { param: "promptId", kind: "prompt", noun: "prompt" },
  // Simulation run detail (opened with `urlParams: { scenarioRunId }`).
  scenarioRunDetail: {
    param: "scenarioRunId",
    kind: "scenario",
    noun: "scenario",
  },
  // Online evaluation (monitor) editor.
  onlineEvaluation: {
    param: "monitorId",
    kind: "evaluation",
    noun: "evaluation",
  },
  // Evaluator editor / history / code editor — all key off `drawer.evaluatorId`.
  evaluatorEditor: {
    param: "evaluatorId",
    kind: "evaluation",
    noun: "evaluation",
  },
  evaluatorHistory: {
    param: "evaluatorId",
    kind: "evaluation",
    noun: "evaluation",
  },
  codeEvaluatorEditor: {
    param: "evaluatorId",
    kind: "evaluation",
    noun: "evaluation",
  },
  // TODO(langy): the dataset drawers (`addOrEditDataset`, `addDatasetRecord`)
  // and `automation` carry their target in a nested / complex prop, not a flat
  // URL param, so there's no reliable id to read here. Datasets are already
  // covered by the `/datasets/<id>` route chip; add these once they expose a
  // flat `drawer.datasetId` / `drawer.automationId`.
};

/**
 * Parse the drawer out of a `location.search` string and map it to a context
 * chip. Returns `[]` when no drawer is open or the open drawer isn't one that
 * names a resource. Pure so it can be unit-tested without a router.
 */
export function drawerContextChips(search: string): LangyContextChip[] {
  const params = new URLSearchParams(search);
  const open = params.get("drawer.open");
  if (!open) return [];

  const spec = DRAWER_CHIP_SPECS[open];
  if (!spec) return [];

  const ref = params.get(`drawer.${spec.param}`);
  if (!ref) return [];

  return [
    {
      // Resource-scoped id (not drawer-scoped) so a drawer trace chip dedups
      // against the same route/table trace chip, and dismissal stays keyed to
      // the resource: a new target id re-surfaces the chip.
      id: `${spec.kind}:${ref}`,
      kind: spec.kind,
      label: `${spec.noun} ${shortenId(ref)}`,
      ref,
    },
  ];
}

/** Shorten a long id for a chip label: `3f9a01…c2`. */
function shortenId(id: string): string {
  if (id.length <= 10) return id;
  return `${id.slice(0, 6)}…${id.slice(-2)}`;
}
