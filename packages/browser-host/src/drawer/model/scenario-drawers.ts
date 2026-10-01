import type { WireOf } from "@langwatch/api/web";
import type { Scenario } from "@langwatch/scenario-contract";

/** What a caller hands scenario's run detail drawer; the run itself travels as URL params. */
export type UiScenarioRunDetailDrawerProps = {
  open?: boolean;
};

/**
 * The props scenario's case editor accepts at open time. The three URL-serializable fields
 * survive a reload; the flow callback is registered separately via `setFlowCallbacks`.
 */
export type UiAgentTestingCaseEditorDrawerProps = {
  /** The scenario being edited, or absent for a new one. */
  scenarioId?: string;
  /** The suite a new scenario starts in. */
  testSuiteId?: string;
  /** "true" opens the scenario with its version history strip open. */
  showHistory?: string;
  /** Called when a scenario is saved. `shouldRunAfterSave` is true for Save & Run. */
  onSaved?: (saved: WireOf<Scenario>, options: { shouldRunAfterSave: boolean }) => void;
};
