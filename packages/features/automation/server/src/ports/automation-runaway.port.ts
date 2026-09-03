type LimitEmailKind = "ceiling_reached" | "paused";

export type ClaimLease = { key: string; token: string };

/** Explicit infrastructure ports used by Automation's containment policy. */
export abstract class AutomationRunawayPort {
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
  }): Promise<void>;
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
