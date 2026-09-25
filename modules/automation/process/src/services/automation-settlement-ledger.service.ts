import type {
  AutomationPersistCapBreach,
  AutomationPersistCapDecision,
  TriggerSummary,
  WebhookDeliveryInput,
} from "@langwatch/automation-contract";
import { type Instant } from "@langwatch/time";

import type { AutomationClock } from "../app/automation.members.ts";
import type { AutomationPersistCapRepository } from "../repositories/automation-persist-cap.repository.ts";
import {
  AutomationSettlementLedgerRepository,
  type AutomationSettlementBreach,
  type AutomationSettlementPersistCap,
} from "../repositories/automation-settlement-ledger.repository.ts";
import type { EmailSuppressionRepository } from "../repositories/email-suppression.repository.ts";
import type { TriggerRepository } from "../repositories/trigger.repository.ts";
import type { WebhookDeliveryRepository } from "../repositories/webhook-delivery.repository.ts";
import { decidePersistCap } from "../rules/persist-cap.rules.ts";
import { ActiveTriggerCacheService } from "./active-trigger-cache.service.ts";

/**
 * Settlement reads/writes must use {@link ActiveTriggerCacheService} to prevent
 * duplicate caches from giving different answers about live automations.
 */
export class AutomationSettlementLedgerService extends AutomationSettlementLedgerRepository {
  static create(input: {
    triggers: TriggerRepository;
    suppressions: EmailSuppressionRepository;
    webhookDeliveries: WebhookDeliveryRepository;
    clock: AutomationClock;
    persistCaps: AutomationPersistCapRepository;
    persistCap: AutomationSettlementPersistCap;
    breach: AutomationSettlementBreach;
  }): AutomationSettlementLedgerService {
    return new AutomationSettlementLedgerService({
      triggers: input.triggers,
      active: ActiveTriggerCacheService.create({ triggers: input.triggers, clock: input.clock }),
      suppressions: input.suppressions,
      webhookDeliveries: input.webhookDeliveries,
      persistCaps: input.persistCaps,
      persistCap: input.persistCap,
      breach: input.breach,
    });
  }

  private readonly triggers: TriggerRepository;

  private readonly active: ActiveTriggerCacheService;

  private readonly suppressions: EmailSuppressionRepository;

  private readonly webhookDeliveries: WebhookDeliveryRepository;

  private readonly persistCaps: AutomationPersistCapRepository;

  private readonly persistCap: AutomationSettlementPersistCap;

  private readonly breach: AutomationSettlementBreach;

  private constructor({
    triggers,
    active,
    suppressions,
    webhookDeliveries,
    persistCaps,
    persistCap,
    breach,
  }: {
    triggers: TriggerRepository;
    active: ActiveTriggerCacheService;
    suppressions: EmailSuppressionRepository;
    webhookDeliveries: WebhookDeliveryRepository;
    persistCaps: AutomationPersistCapRepository;
    persistCap: AutomationSettlementPersistCap;
    breach: AutomationSettlementBreach;
  }) {
    super();

    this.triggers = triggers;

    this.active = active;

    this.suppressions = suppressions;

    this.webhookDeliveries = webhookDeliveries;

    this.persistCaps = persistCaps;

    this.persistCap = persistCap;

    this.breach = breach;
  }

  findActiveTraceTriggersForProject(projectId: string): Promise<TriggerSummary[]> {
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

  async consumePersistCapSlot(input: {
    projectId: string;
    triggerId: string;
    now: Instant;
    cap: number;
    dedupKey: string;
  }): Promise<AutomationPersistCapDecision> {
    const slot = await this.persistCaps.consumeSlot(input);
    return decidePersistCap({ count: slot.count, cap: input.cap });
  }

  handlePersistCapBreach(input: AutomationPersistCapBreach): Promise<void> {
    return this.breach.handle(input);
  }
}

const normalizeEmail = (email: string): string => email.trim().toLowerCase();
