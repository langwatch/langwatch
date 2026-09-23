import type {
  AutomationPersistCapBreach,
  AutomationPersistCapDecision,
  TriggerSummary,
  WebhookDeliveryInput,
} from "@langwatch/automation-contract";
import { type Instant } from "@langwatch/time";

import type { AutomationClock } from "../app/automation.members.ts";
import {
  AutomationSettlementLedger,
  type AutomationSettlementBreach,
  type AutomationSettlementPersistCap,
} from "../repositories/automation-settlement-ledger.repository.ts";
import type { EmailSuppressionRepository } from "../repositories/email-suppression.repository.ts";
import type { TriggerRepository } from "../repositories/trigger.repository.ts";
import type { WebhookDeliveryRepository } from "../repositories/webhook-delivery.repository.ts";
import { ActiveTriggerCacheService } from "./active-trigger-cache.service.ts";
import {
  AutomationPersistCapService,
  type AutomationPersistCapRedis,
} from "./persist-cap.service.ts";

/**
 * Settlement reads/writes must use {@link ActiveTriggerCacheService} to prevent
 * duplicate caches from giving different answers about live automations.
 */
export class AutomationSettlementLedgerService extends AutomationSettlementLedger {
  static create(input: {
    triggers: TriggerRepository;
    suppressions: EmailSuppressionRepository;
    webhookDeliveries: WebhookDeliveryRepository;
    clock: AutomationClock;
    redis?: AutomationPersistCapRedis | null;
    persistCap: AutomationSettlementPersistCap;
    breach: AutomationSettlementBreach;
  }): AutomationSettlementLedgerService {
    return new AutomationSettlementLedgerService({
      triggers: input.triggers,
      active: ActiveTriggerCacheService.create({ triggers: input.triggers, clock: input.clock }),
      suppressions: input.suppressions,
      webhookDeliveries: input.webhookDeliveries,
      redis: input.redis ?? null,
      persistCap: input.persistCap,
      breach: input.breach,
    });
  }

  private readonly triggers: TriggerRepository;

  private readonly active: ActiveTriggerCacheService;

  private readonly suppressions: EmailSuppressionRepository;

  private readonly webhookDeliveries: WebhookDeliveryRepository;

  private readonly redis: AutomationPersistCapRedis | null;

  private readonly persistCap: AutomationSettlementPersistCap;

  private readonly breach: AutomationSettlementBreach;

  private constructor({
    triggers,
    active,
    suppressions,
    webhookDeliveries,
    redis,
    persistCap,
    breach,
  }: {
    triggers: TriggerRepository;
    active: ActiveTriggerCacheService;
    suppressions: EmailSuppressionRepository;
    webhookDeliveries: WebhookDeliveryRepository;
    redis: AutomationPersistCapRedis | null;
    persistCap: AutomationSettlementPersistCap;
    breach: AutomationSettlementBreach;
  }) {
    super();

    this.triggers = triggers;

    this.active = active;

    this.suppressions = suppressions;

    this.webhookDeliveries = webhookDeliveries;

    this.redis = redis;

    this.persistCap = persistCap;

    this.breach = breach;
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
    now: Instant;
    cap: number;
    dedupKey: string;
  }): Promise<AutomationPersistCapDecision> {
    return AutomationPersistCapService.consumePersistCapSlot({
      ...input,
      redis: this.redis,
    });
  }

  handlePersistCapBreach(input: AutomationPersistCapBreach): Promise<void> {
    return this.breach.handle(input);
  }
}

const normalizeEmail = (email: string): string => email.trim().toLowerCase();
