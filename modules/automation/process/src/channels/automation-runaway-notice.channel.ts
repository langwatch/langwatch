import type { AutomationLimitNextStep } from "@langwatch/automation-contract";

type LimitEmailKind = "ceiling_reached" | "paused";

/** The mail sent when an automation is capped or auto-paused. */
export abstract class AutomationRunawayNotice {
  abstract sendLimitEmail(params: {
    to: string[];
    kind: LimitEmailKind;
    automationName: string;
    projectName: string;
    dailyCeiling: number;
    skippedToday: number;
    actionUrl: string;
    /** Only ever passed for a `ceiling_reached` notice. */
    nextStep?: AutomationLimitNextStep;
  }): Promise<void>;
}
