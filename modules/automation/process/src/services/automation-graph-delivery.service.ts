import type { EmailSuppressionRepository } from "../repositories/email-suppression.repository.ts";
import type { TriggerRepository } from "../repositories/trigger.repository.ts";

const normalizeEmail = (email: string): string => email.trim().toLowerCase();

/** Graph delivery's Automation persistence, over repository interfaces only. */
export class AutomationGraphDeliveryService implements AutomationGraphDelivery {
  private constructor(
    private readonly triggers: TriggerRepository,
    private readonly suppressions: EmailSuppressionRepository,
  ) {}

  static create(input: {
    triggers: TriggerRepository;
    suppressions: EmailSuppressionRepository;
  }): AutomationGraphDeliveryService {
    return new AutomationGraphDeliveryService(input.triggers, input.suppressions);
  }

  async filterSuppressed(input: {
    projectId: string;
    triggerId: string;
    emails: string[];
  }): Promise<string[]> {
    const rows = await this.suppressions.findMatching(input);
    const blocked = new Set(rows.map((row) => normalizeEmail(row.email)));
    return input.emails.filter((email) => !blocked.has(normalizeEmail(email)));
  }

  isSendClaimed(input: {
    triggerId: string;
    traceId: string;
    projectId: string;
  }): Promise<boolean> {
    return this.triggers.isSendClaimed(input);
  }

  claimSend(input: { triggerId: string; traceId: string; projectId: string }): Promise<boolean> {
    return this.triggers.claimSend(input);
  }
}

/**
 * Automation-owned persistence operations used by the host's graph delivery
 * adapter. Keeping this nominal boundary prevents composition from reaching
 * into the process service while it is being constructed.
 */
export interface AutomationGraphDelivery {
  filterSuppressed(input: {
    projectId: string;
    triggerId: string;
    emails: string[];
  }): Promise<string[]>;
  isSendClaimed(input: { triggerId: string; traceId: string; projectId: string }): Promise<boolean>;
  claimSend(input: { triggerId: string; traceId: string; projectId: string }): Promise<boolean>;
}
