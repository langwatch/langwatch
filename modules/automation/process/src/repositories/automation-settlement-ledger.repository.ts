import type {
  AutomationPersistCapBreach,
  AutomationPersistCapDecision,
  TriggerSummary,
  WebhookDeliveryInput,
} from "@langwatch/automation-contract";
import type { Instant } from "@langwatch/time";

// Port for trigger settlement; extracts the ten methods it needs from the full
// AutomationService into three concerns: triggers + send claims, persist ceiling, webhook log.
export abstract class AutomationSettlementLedgerRepository {
  /** The project's active trace automations, as the settled digest re-reads them. */
  abstract findActiveTraceTriggersForProject(projectId: string): Promise<TriggerSummary[]>;

  /** Whether this (trigger, trace) has already been delivered for. */
  abstract isSendClaimed(input: {
    triggerId: string;
    traceId: string;
    projectId: string;
  }): Promise<boolean>;

  /**
   * Claims one delivery, exactly once: the claim is what makes a
   * redelivered settlement safe, since the digest's keying boundary
   * survives a retry rather than mailing once per delivery attempt.
   */
  abstract claimSend(input: {
    triggerId: string;
    traceId: string;
    projectId: string;
  }): Promise<boolean>;

  /** The subset of a page's traces this trigger has already been claimed for. */
  abstract filterSendClaimed(input: {
    triggerId: string;
    traceIds: string[];
    projectId: string;
  }): Promise<Set<string>>;

  /** Stamps the automation as having fired, for the list screen's own reading. */
  abstract updateLastRunAt(input: { triggerId: string; projectId: string }): Promise<void>;

  /** Recipients this project or trigger has been unsubscribed from. */
  abstract filterSuppressed(input: {
    projectId: string;
    triggerId: string;
    emails: string[];
  }): Promise<string[]>;

  /** One line in the delivery log a customer reads their webhook failures from. */
  abstract recordWebhookDelivery(input: WebhookDeliveryInput): Promise<void>;

  /** How many persist-class matches this project may write today. */
  abstract resolvePersistDailyCap(projectId: string): Promise<number>;

  /** Takes one slot against that ceiling, or reports that it is spent. */
  abstract consumePersistCapSlot(input: {
    projectId: string;
    triggerId: string;
    now: Instant;
    cap: number;
    dedupKey: string;
  }): Promise<AutomationPersistCapDecision>;

  // Contains an automation that ran past its cap; containment is mandatory but
  // the notifier (mail + auto-pause) is optional.
  abstract handlePersistCapBreach(input: AutomationPersistCapBreach): Promise<void>;
}

export type AutomationSettlementPersistCap =
  | { readonly kind: "fixed"; readonly cap: number }
  | { readonly kind: "resolved"; resolve(projectId: string): Promise<number> };

export abstract class AutomationSettlementBreach {
  abstract handle(input: AutomationPersistCapBreach): Promise<void>;
}
