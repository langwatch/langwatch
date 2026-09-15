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
  "scenarioRun",
] as const;

export type LangyNavigateResourceKind = (typeof LANGY_NAVIGATE_RESOURCE_KINDS)[number];

/**
 * Order is not significant: no prefix here is a prefix of another.
 * (`prompt_version_` ids fall into `prompt_` and miss the prompt lookup,
 * correctly dropping.)
 */
const RESOURCE_PREFIXES: ReadonlyArray<readonly [string, LangyNavigateResourceKind]> = [
  ["prompt_", "prompt"],
  ["dataset_", "dataset"],
  ["workflow_", "workflow"],
  ["experiment_", "experiment"],
  ["monitor_", "monitor"],
  ["evaluator_", "evaluator"],
  ["agent_", "agent"],
  ["scenariorun_", "scenarioRun"],
];

/** The resource this id names, or null when no prefix claims it. */
export function navigateResourceKindFor(resourceId: string): LangyNavigateResourceKind | null {
  return RESOURCE_PREFIXES.find(([prefix]) => resourceId.startsWith(prefix))?.[1] ?? null;
}
