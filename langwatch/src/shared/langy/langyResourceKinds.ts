/**
 * The kinds of thing the user can hand Langy as context.
 *
 * ONE list, because there are two sides that must agree about it and they
 * cannot see each other: the UI mints chips (`LangyContextChip`) and the server
 * validates them off the wire (`langyResourceContextSchema`). Those were two
 * hand-maintained enums, and adding a kind to the UI silently produced chips the
 * server rejected — the failure of a duplicated list, arriving as far as
 * possible from the edit that caused it.
 *
 * Lives in `shared/` for the same reason the skill catalogue does: imported DOWN
 * by the server and ACROSS by the UI, so the server never depends on the app
 * layer. Pure data, belonging to neither side.
 */
export const LANGY_RESOURCE_KINDS = [
  "project",
  "experiment",
  "trace",
  "prompt",
  "dataset",
  "dashboard",
  "scenario",
  // A single evaluator / online-evaluation the user has open. Distinct from
  // `experiment`, which is an offline run.
  "evaluation",
  // A workflow or agent built in the optimization studio.
  "workflow",
  // A configured agent.
  "agent",
  // A trigger / automation rule.
  "automation",
  // A human annotation, or an item in an annotation queue.
  "annotation",
  // A multi-row selection in the Trace Explorer ("N traces selected"). `ref`
  // carries the selected ids, so the agent acts on exactly what is checked.
  "selection",
  // An active filter / query on the Trace Explorer, so "these traces" is scoped
  // to what the user narrowed to.
  "filter",
] as const;

export type LangyResourceKind = (typeof LANGY_RESOURCE_KINDS)[number];
