// Public entry point for the automations overview; exports the actionParams shape and activity
// components shared between overview screen and authoring flow.

export {
  AutomationHistory,
  toAutomationActivityEntries,
  type AutomationActivityEntry,
  type AutomationActivityFire,
  type AutomationActivityTrigger,
} from "./ui/elements/automation-history.tsx";
export {
  AutomationUseCaseStrip,
  type AutomationUseCaseKind,
  type AutomationUseCasePrefill,
} from "./ui/elements/automation-use-case-strip.tsx";
export * from "./ui/elements/automation-table-cells.tsx";
export type * from "./model/trigger-action-params.ts";
