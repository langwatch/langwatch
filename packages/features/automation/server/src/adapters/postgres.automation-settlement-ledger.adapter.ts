import type {
  AutomationPersistCapBreach,
  AutomationPersistCapDecision,
  TriggerSummary,
  WebhookDeliveryInput,
} from "@langwatch/automation-contract";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import type { AutomationClockPort } from "../ports/automation-clock.port";
import { AutomationSettlementLedgerPort } from "../ports/automation-settlement-ledger.port";
import { PrismaEmailSuppressionRepository } from "../repositories/prisma/prisma.email-suppression.repository";
import { PrismaTriggerRepository } from "../repositories/prisma/prisma.trigger.repository";
import { PrismaWebhookDeliveryRepository } from "../repositories/prisma/prisma.webhook-delivery.repository";
import type { EmailSuppressionRepository } from "../repositories/email-suppression.repository";
import type { TriggerRepository } from "../repositories/trigger.repository";
import type { WebhookDeliveryRepository } from "../repositories/webhook-delivery.repository";
import { ActiveTriggerCacheService } from "../services/active-trigger-cache.service";
import {
  AutomationPersistCapService,
  type AutomationPersistCapRedisPort,
} from "../services/persist-cap.service";

/** The four tables settlement's ledger touches, named here and nowhere above it. */
export type AutomationSettlementLedgerDatabase = Pick<
  PrismaClient,
  "trigger" | "triggerSent" | "emailSuppression" | "webhookEndpointDelivery" | "$queryRaw"
>;

/**
 * The ceiling a project's persist automations share for a day.
 *
 * A number rather than a plan lookup. The wide service resolves it from the
 * organization's active plan and caches it for ten minutes; that lookup needs
 * an entitlement provider, which needs the licence handler and the billing
 * subscription source, and a background process that composes none of them
 * would warn once per dispatch on its way to this same fallback. So the
 * fallback is stated at composition instead, and a process that HAS a plan
 * provider passes the resolved value in.
 */
export type AutomationSettlementPersistCap =
  | { readonly kind: "fixed"; readonly cap: number }
  | { readonly kind: "resolved"; resolve(projectId: string): Promise<number> };

/**
 * What a process does about an automation that ran past its ceiling.
 *
 * Containment is mail to the organization's admins plus an auto-pause, and both
 * need collaborators — a trace-count read, a recipient resolver, a mailer —
 * that a process composing only settlement need not have. The breach is
 * reported to this port either way, so a refusal is BY NAME and the skip is
 * still counted; what an absent implementation costs is the notification, not
 * the containment.
 */
export abstract class AutomationSettlementBreachPort {
  abstract handle(input: AutomationPersistCapBreach): Promise<void>;
}

/**
 * The ten settlement reads and writes, over one Postgres client and one Redis.
 *
 * The trigger catalogue goes through {@link ActiveTriggerCacheService} rather
 * than straight to the repository, and it must: two caches over the one table
 * would give one process two different ideas of which automations are live, so
 * a settled match could be confirmed against an automation the graph half had
 * already seen deleted. One minute of staleness is inherited, not introduced —
 * it was already true of every pod in a multi-pod deployment.
 */
export class PostgresAutomationSettlementLedgerAdapter extends AutomationSettlementLedgerPort {
  static create(options: {
    /** The one database client the composing process opened. */
    prisma: AutomationSettlementLedgerDatabase;
    clock: AutomationClockPort;
    /**
     * The shared Redis the daily ceiling counts in. Absent falls back to
     * per-process counters, which is the application's own behaviour when Redis
     * is down: a ceiling enforced per pod rather than per fleet.
     */
    redis?: AutomationPersistCapRedisPort | null;
    persistCap: AutomationSettlementPersistCap;
    breach: AutomationSettlementBreachPort;
  }): PostgresAutomationSettlementLedgerAdapter {
    const triggers = PrismaTriggerRepository.create(options.prisma, options.clock);

    return new PostgresAutomationSettlementLedgerAdapter(
      triggers,
      ActiveTriggerCacheService.create({ triggers, clock: options.clock }),
      PrismaEmailSuppressionRepository.create(options.prisma),
      PrismaWebhookDeliveryRepository.create(options.prisma),
      options.redis ?? null,
      options.persistCap,
      options.breach,
    );
  }

  private constructor(
    private readonly triggers: TriggerRepository,
    private readonly active: ActiveTriggerCacheService,
    private readonly suppressions: EmailSuppressionRepository,
    private readonly webhookDeliveries: WebhookDeliveryRepository,
    private readonly redis: AutomationPersistCapRedisPort | null,
    private readonly persistCap: AutomationSettlementPersistCap,
    private readonly breach: AutomationSettlementBreachPort,
  ) {
    super();
  }

  getActiveTraceTriggersForProject(projectId: string): Promise<TriggerSummary[]> {
    return this.active.getActiveTraceTriggersForProject(projectId);
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

  filterSendClaimed(input: {
    triggerId: string;
    traceIds: string[];
    projectId: string;
  }): Promise<Set<string>> {
    return this.triggers.findClaimedTraceIds(input);
  }

  updateLastRunAt(input: { triggerId: string; projectId: string }): Promise<void> {
    return this.triggers.updateLastRunAt(input);
  }

  async filterSuppressed(input: {
    projectId: string;
    triggerId: string;
    emails: string[];
  }): Promise<string[]> {
    const rows = await this.suppressions.findMatching({
      projectId: input.projectId,
      triggerId: input.triggerId,
    });
    const blocked = new Set(rows.map((row) => normalizeEmail(row.email)));

    return input.emails.filter((email) => !blocked.has(normalizeEmail(email)));
  }

  recordWebhookDelivery(input: WebhookDeliveryInput): Promise<void> {
    return this.webhookDeliveries.create(input);
  }

  resolvePersistDailyCap(projectId: string): Promise<number> {
    return this.persistCap.kind === "fixed"
      ? Promise.resolve(this.persistCap.cap)
      : this.persistCap.resolve(projectId);
  }

  consumePersistCapSlot(input: {
    projectId: string;
    triggerId: string;
    now: Date;
    cap: number;
    dedupKey: string;
  }): Promise<AutomationPersistCapDecision> {
    return AutomationPersistCapService.consumePersistCapSlot({ ...input, redis: this.redis });
  }

  handlePersistCapBreach(input: AutomationPersistCapBreach): Promise<void> {
    return this.breach.handle(input);
  }
}

const normalizeEmail = (email: string): string => email.trim().toLowerCase();
