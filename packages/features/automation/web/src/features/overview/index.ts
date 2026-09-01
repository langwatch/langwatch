/**
 * The automations overview, as the rest of this package composes it.
 *
 * A private feature's public entry. The list's cells, the activity feed and the
 * use-case strip belong to the screen; what the authoring flow reaches for is
 * the ONE type both halves read — the shape of a saved automation's
 * `actionParams` — which is here rather than in package-global `model` because
 * it is the overview's reading of that column and the two travel together.
 */

export {
  AutomationHistory,
  toAutomationActivityEntries,
  type AutomationActivityEntry,
  type AutomationActivityFire,
  type AutomationActivityTrigger,
} from "./ui/elements/automation-history";
export {
  AutomationUseCaseStrip,
  type AutomationUseCaseKind,
  type AutomationUseCasePrefill,
} from "./ui/elements/automation-use-case-strip";
export * from "./ui/elements/automation-table-cells";
export type * from "./model/trigger-action-params";
