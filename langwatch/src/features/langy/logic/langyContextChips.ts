import type { LangyContextChip } from "../stores/langyStore";

/**
 * Compose the candidate context-chip list from every source, in priority order.
 *
 * Callers pass their sources already flattened, MOST-SPECIFIC FIRST. The first
 * chip to claim an id wins; later duplicates are dropped. That ordering is what
 * makes a clicked target and an auto-derived one collapse into a single chip:
 * open the trace drawer for `abc123` (Langy derives `trace:abc123` from the
 * URL) and then click the same trace's row, and the composer still shows one
 * chip — the auto-derived one, whose label came from the richer source.
 *
 * Pure, so the merge rule can be unit-tested without a router or a store.
 */
export function mergeContextChips(
  sources: (LangyContextChip | null | undefined)[],
): LangyContextChip[] {
  const merged: LangyContextChip[] = [];
  const seen = new Set<string>();

  for (const chip of sources) {
    if (!chip || seen.has(chip.id)) continue;
    seen.add(chip.id);
    merged.push(chip);
  }

  return merged;
}

/**
 * Shorten a long id for a chip label: `3f9a01…c2`. Shared so a chip minted by a
 * clicked trace row reads identically to the one the route derives — same id,
 * same label, so they dedupe instead of stacking.
 */
export function shortenChipId(id: string): string {
  if (id.length <= 10) return id;
  return `${id.slice(0, 6)}…${id.slice(-2)}`;
}

/** The stable chip a trace becomes, wherever it was picked up from. */
export function traceContextChip(
  traceId: string,
  displayName?: string | null,
): LangyContextChip {
  const name = displayName?.trim();
  return {
    id: `trace:${traceId}`,
    kind: "trace",
    // An id is useful to the tool, not to the person. Keep it in `ref` while
    // using the trace/span name anywhere the user has actually supplied one.
    label: name ? `Trace · ${name}` : `Trace · ${shortenChipId(traceId)}`,
    ref: traceId,
  };
}

/**
 * The stable chip a dataset becomes. The id is keyed on the dataset id alone,
 * so the chip a list row mints (which knows the name) and the one the
 * `/datasets/<id>` route derives (which doesn't) dedupe into one.
 */
export function datasetContextChip({
  datasetId,
  name,
}: {
  datasetId: string;
  name?: string;
}): LangyContextChip {
  return {
    id: `dataset:${datasetId}`,
    kind: "dataset",
    label: name ? `dataset: ${name}` : `dataset ${shortenChipId(datasetId)}`,
    ref: datasetId,
  };
}

/**
 * Every other resource's chip has the same shape, so it is written once.
 *
 * The two rules that matter are both structural here rather than repeated at
 * thirty call sites:
 *
 *   - The id is `<kind>:<ref>` and nothing else, which is what makes a chip the
 *     SAME chip however it was picked up. `useLangyPageContext.routeChips` and
 *     `drawerContextChips` mint exactly that key from the URL, so a card the
 *     user clicked on a list page and the resource they then opened collapse
 *     into one chip instead of stacking two.
 *   - The label leads with the resource's human NAME. An id tells the person
 *     reading the composer nothing; it stays in `ref`, where the agent's tools
 *     want it. A shortened id is the fallback for the rows that genuinely have
 *     no name.
 */
function namedResourceChip({
  kind,
  noun,
  id,
  name,
  ref,
}: {
  kind: LangyContextChip["kind"];
  /** How the chip reads to a person: "workflow: checkout triage". */
  noun: string;
  /** The key the chip id is built from — must match what the route derives. */
  id: string;
  name?: string | null;
  /** What travels to the agent, when it differs from the id key. */
  ref?: string;
}): LangyContextChip {
  const trimmed = name?.trim();
  return {
    id: `${kind}:${id}`,
    kind,
    label: trimmed ? `${noun}: ${trimmed}` : `${noun} ${shortenChipId(id)}`,
    ref: ref ?? id,
  };
}

/** A workflow or agent built in the optimization studio. */
export function workflowContextChip({
  workflowId,
  name,
}: {
  workflowId: string;
  name?: string | null;
}): LangyContextChip {
  return namedResourceChip({
    kind: "workflow",
    noun: "workflow",
    id: workflowId,
    name,
  });
}

/** A configured agent. */
export function agentContextChip({
  agentId,
  name,
}: {
  agentId: string;
  name?: string | null;
}): LangyContextChip {
  return namedResourceChip({
    kind: "agent",
    noun: "agent",
    id: agentId,
    name,
  });
}

/** A trigger / automation rule. */
export function automationContextChip({
  automationId,
  name,
}: {
  automationId: string;
  name?: string | null;
}): LangyContextChip {
  return namedResourceChip({
    kind: "automation",
    noun: "automation",
    id: automationId,
    name,
  });
}

/** An annotation, or an annotation queue the user is working through. */
export function annotationContextChip({
  annotationId,
  name,
  noun = "annotation",
}: {
  annotationId: string;
  name?: string | null;
  /** "annotation queue" reads better than "annotation" on the queues list. */
  noun?: string;
}): LangyContextChip {
  return namedResourceChip({
    kind: "annotation",
    noun,
    id: annotationId,
    name,
  });
}

/**
 * An evaluator / monitor — one configured evaluation, not an offline run. Same
 * kind the evaluator and online-evaluation drawers derive, so the card and the
 * drawer opened from it are one chip.
 */
export function evaluationContextChip({
  evaluationId,
  name,
  noun = "evaluation",
}: {
  evaluationId: string;
  name?: string | null;
  /** "evaluator" on the evaluators page, "evaluation" for monitors. */
  noun?: string;
}): LangyContextChip {
  return namedResourceChip({
    kind: "evaluation",
    noun,
    id: evaluationId,
    name,
  });
}

/** A simulation: a scenario set, or one run inside it. */
export function scenarioContextChip({
  scenarioId,
  name,
  noun = "simulation",
}: {
  scenarioId: string;
  name?: string | null;
  noun?: string;
}): LangyContextChip {
  return namedResourceChip({
    kind: "scenario",
    noun,
    id: scenarioId,
    name,
  });
}

/**
 * An offline experiment. Keyed on the SLUG, because that is what
 * `/experiments/<slug>` puts in the URL and therefore what the route-derived
 * chip uses — keying on the database id here would produce two chips for one
 * experiment.
 */
export function experimentContextChip({
  slug,
  name,
}: {
  slug: string;
  name?: string | null;
}): LangyContextChip {
  return namedResourceChip({
    kind: "experiment",
    noun: "experiment",
    id: slug,
    name,
  });
}

/** A dashboard / custom report. */
export function dashboardContextChip({
  dashboardId,
  name,
}: {
  dashboardId: string;
  name?: string | null;
}): LangyContextChip {
  return namedResourceChip({
    kind: "dashboard",
    noun: "dashboard",
    id: dashboardId,
    name,
  });
}

/**
 * The stable chip a prompt becomes. Keyed on the prompt id (the same key the
 * prompt editor drawer derives), labelled by handle when one exists — the
 * handle is also what rides as `ref`, since it is the name the agent's own
 * prompt tools resolve.
 */
export function promptContextChip({
  promptId,
  handle,
}: {
  promptId: string;
  handle?: string | null;
}): LangyContextChip {
  return {
    id: `prompt:${promptId}`,
    kind: "prompt",
    label: handle ? `prompt: ${handle}` : `prompt ${shortenChipId(promptId)}`,
    ref: handle ?? promptId,
  };
}
