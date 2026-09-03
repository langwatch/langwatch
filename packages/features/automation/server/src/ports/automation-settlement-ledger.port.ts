import type {
  AutomationPersistCapBreach,
  AutomationPersistCapDecision,
  TriggerSummary,
  WebhookDeliveryInput,
} from "@langwatch/automation-contract";

/**
 * Everything trigger settlement asks Automation for, and nothing else.
 *
 * The dispatch service used to name the whole `AutomationService` — forty-four
 * methods over report schedules, template test fires, unsubscribe views and the
 * automation CRUD — to reach these ten. A process that wanted to settle a match
 * therefore had to compose all of it or none, which is the same cycle
 * `AutomationGraphActivityPort` broke for the real-time graph path and it is
 * broken here the same way: the published `AutomationService` satisfies this
 * port structurally, so the application passes exactly what it passed before,
 * while a background process composes the ten over its own repositories.
 *
 * The ten are three separate concerns and they are listed in that order: the
 * trigger catalogue and the per-recipient send claims, the daily persist
 * ceiling, and the webhook delivery log.
 */
export abstract class AutomationSettlementLedgerPort {
  /** The project's active trace automations, as the settled digest re-reads them. */
  abstract getActiveTraceTriggersForProject(projectId: string): Promise<TriggerSummary[]>;

  /** Whether this (trigger, trace) has already been delivered for. */
  abstract isSendClaimed(input: {
    triggerId: string;
    traceId: string;
    projectId: string;
  }): Promise<boolean>;

  /**
   * Claims one delivery, exactly once.
   *
   * The claim is what makes a redelivered settlement safe: the boundary a
   * digest is keyed on survives a retry, so without it one trace would be
   * mailed once per delivery attempt.
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
    now: Date;
    cap: number;
    dedupKey: string;
  }): Promise<AutomationPersistCapDecision>;

  /**
   * Contains an automation that ran past its ceiling.
   *
   * Reached at most once per page and behind the caller's own try/catch, which
   * is why a process that composes no runaway notifier may refuse it by name:
   * the matches are still skipped and the skip is still logged with the project,
   * the trigger and the count — what is lost is the mail to the organization's
   * admins and the auto-pause, not the containment.
   */
  abstract handlePersistCapBreach(input: AutomationPersistCapBreach): Promise<void>;
}
