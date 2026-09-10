import type { PrismaClient } from "@langwatch/prisma-client/generated";
import type { AutomationClock } from "../../app/automation.infrastructure.ts";
import type {
  AutomationSettlementBreach,
  AutomationSettlementPersistCap,
} from "../automation-settlement-ledger.repository.ts";
import { PrismaEmailSuppressionRepository } from "./prisma.email-suppression.repository.ts";
import { PrismaTriggerRepository } from "./prisma.trigger.repository.ts";
import { PrismaWebhookDeliveryRepository } from "./prisma.webhook-delivery.repository.ts";
import { AutomationSettlementLedgerService } from "../../services/automation-settlement-ledger.service.ts";
import type { AutomationPersistCapRedis } from "../../services/persist-cap.service.ts";

/** The four tables settlement's ledger touches, named here and nowhere above it. */
export type AutomationSettlementLedgerDatabase = Pick<
  PrismaClient,
  | "trigger"
  | "triggerSent"
  | "emailSuppression"
  | "webhookEndpointDelivery"
  | "project"
  | "customGraph"
  | "$queryRaw"
  | "$executeRaw"
>;

/** Process-composition shim for the settlement ledger's ten reads and writes. */
export class PrismaAutomationSettlementLedgerRepository {
  static create(options: {
    /** The one database client the composing process opened. */
    prisma: AutomationSettlementLedgerDatabase;
    clock: AutomationClock;
    /**
     * The shared Redis the daily ceiling counts in. Absent falls back to
     * per-process counters, which is the application's own behaviour when Redis
     * is down: a ceiling enforced per pod rather than per fleet.
     */
    redis?: AutomationPersistCapRedis | null;
    persistCap: AutomationSettlementPersistCap;
    breach: AutomationSettlementBreach;
  }): AutomationSettlementLedgerService {
    const triggers = PrismaTriggerRepository.create(options.prisma, options.clock);

    return AutomationSettlementLedgerService.create({
      triggers,
      suppressions: PrismaEmailSuppressionRepository.create(options.prisma),
      webhookDeliveries: PrismaWebhookDeliveryRepository.create(options.prisma),
      clock: options.clock,
      redis: options.redis ?? null,
      persistCap: options.persistCap,
      breach: options.breach,
    });
  }
}
