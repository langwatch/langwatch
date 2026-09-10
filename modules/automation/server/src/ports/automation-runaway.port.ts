import type { AutomationLimitNextStep } from "@langwatch/automation-contract";

type LimitEmailKind = "ceiling_reached" | "paused";

export type ClaimLease = { key: string; token: string };

/** Explicit infrastructure ports used by Automation's containment policy. */
export abstract class AutomationRunaway {
  abstract countProjectTraces24h(projectId: string): Promise<number>;
  abstract notificationRecipients(params: {
    projectId: string;
    triggerId: string;
  }): Promise<string[]>;
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
  /**
   * Where this project's organization can go for a higher ceiling. Called
   * only for a `ceiling_reached` breach, never for a pause.
   */
  abstract resolveNextStep(projectId: string): Promise<AutomationLimitNextStep | undefined>;
  abstract tryClaimOnce(key: string, ttlSeconds?: number): Promise<ClaimLease | null>;
  abstract releaseClaim(lease: ClaimLease): Promise<void>;
  abstract projectName(projectId: string): Promise<string>;
  abstract automationUrl(params: { projectId: string; triggerId: string }): Promise<string>;
  abstract onCeilingBreach(): void;
  abstract onAutoPaused(reason: string): void;
  abstract onContainmentFailed(): void;
  abstract error(fields: Record<string, unknown>, message: string): void;
  abstract info(fields: Record<string, unknown>, message: string): void;
}
