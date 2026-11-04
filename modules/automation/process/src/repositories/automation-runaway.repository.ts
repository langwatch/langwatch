import type { AutomationLimitNextStep } from "@langwatch/automation-contract";

export type ClaimLease = { key: string; token: string };

/** The data this containment policy reads and the leases it claims. */
export abstract class AutomationRunawayRepository {
  /** The project's distinct traces that occurred on UTC day `day` (whole days since the epoch). */
  abstract countProjectTracesOnDay(projectId: string, day: number): Promise<number>;
  abstract notificationRecipients(params: {
    projectId: string;
    triggerId: string;
  }): Promise<string[]>;
  /**
   * Where this project's organization can go for a higher ceiling. Called
   * only for a `ceiling_reached` breach, never for a pause.
   */
  abstract findNextStep(projectId: string): Promise<AutomationLimitNextStep | undefined>;
  abstract claimOnce(key: string, ttlSeconds?: number): Promise<ClaimLease | "already-claimed">;
  abstract releaseClaim(lease: ClaimLease): Promise<void>;
  abstract projectName(projectId: string): Promise<string>;
  abstract automationUrl(params: { projectId: string; triggerId: string }): Promise<string>;
}
