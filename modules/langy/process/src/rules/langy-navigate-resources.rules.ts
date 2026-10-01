/**
 * Which resource an id names, read from its prefix alone. The table is the
 * whole allow-list: an id it does not know is never a destination.
 */

/* Classification runs before any tenancy-scoped lookup. */

/*
 * Ids are matched on the raw string: an id is case-sensitive, and lowercasing
 * one would name a resource that does not exist. Page names carry no
 * underscore, so the two namespaces cannot collide.
 */

export const LANGY_NAVIGATE_RESOURCE_KINDS = [
  "prompt",
  "dataset",
  "workflow",
  "experiment",
  "monitor",
  "evaluator",
  "agent",
  "scenario",
  "scenarioRun",
] as const;

export type LangyNavigateResourceKind = (typeof LANGY_NAVIGATE_RESOURCE_KINDS)[number];

/**
 * Order is not significant: no prefix here is a prefix of another.
 * (`prompt_version_` ids fall into `prompt_` and miss the prompt lookup,
 * correctly dropping.)
 */
const RESOURCE_PREFIXES: readonly (readonly [string, LangyNavigateResourceKind])[] = [
  ["prompt_", "prompt"],
  ["dataset_", "dataset"],
  ["workflow_", "workflow"],
  ["experiment_", "experiment"],
  ["monitor_", "monitor"],
  ["evaluator_", "evaluator"],
  ["agent_", "agent"],
  ["scenario_", "scenario"],
  ["scenariorun_", "scenarioRun"],
];

/** The resource this id names, or null when no prefix claims it. */
export function detectNavigateResourceKind(resourceId: string): LangyNavigateResourceKind | null {
  return RESOURCE_PREFIXES.find(([prefix]) => resourceId.startsWith(prefix))?.[1] ?? null;
}

/**
 * The address the product's own links open for a resource Langy builds itself;
 * agents, scenarios and scenario runs are addressed by their owners instead.
 * A prompt opens in the playground as a tab, not as a drawer over its empty state.
 */
export const NAVIGATE_RESOURCE_PATHS = {
  prompt: (id: string) => `/prompts?promptId=${encodeURIComponent(id)}`,
  dataset: (id: string) => `/datasets/${encodeURIComponent(id)}`,
  workflow: (id: string) => `/studio/${encodeURIComponent(id)}`,
  experiment: (slugOrId: string) => `/experiments/${encodeURIComponent(slugOrId)}`,
  monitor: (id: string) =>
    `/online-evaluations?drawer.open=onlineEvaluation&drawer.monitorId=${encodeURIComponent(id)}`,
  evaluator: (id: string) =>
    `/evaluators?drawer.open=evaluatorEditor&drawer.evaluatorId=${encodeURIComponent(id)}`,
} as const satisfies Partial<Record<LangyNavigateResourceKind, (id: string) => string>>;
