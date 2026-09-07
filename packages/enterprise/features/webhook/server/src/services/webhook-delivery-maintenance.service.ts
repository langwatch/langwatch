// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * Outbox and delivery-log retention. The sweeps are global, so exactly one pod runs each
 * hourly one, decided by a compare-and-set on a singleton stream row; an in-process throttle
 * keeps the hot deliver path from probing that row more than once a minute.
 */

import { createLogger } from "@langwatch/observability";
import {
  MAINTENANCE_INTERVAL_MS,
  MAINTENANCE_PROCESS_KEY,
  MAINTENANCE_TENANT,
  OUTBOX_ROW_RETENTION_MS,
  WEBHOOK_DELIVERY_PROCESS_NAME,
} from "../rules/webhook-delivery-contract.rules.ts";
import type { WebhookDeliveryProcessDeps } from "./webhook-delivery.service.ts";

const logger = createLogger("langwatch:webhooks:delivery-process");

/** In-process throttle so the hot deliver path checks the CAS row at most once a minute per pod. */
let maintenanceLastCheckedMs = 0;

export class WebhookDeliveryMaintenanceService {
  static create(deps: WebhookDeliveryProcessDeps): WebhookDeliveryMaintenanceService {
    return new WebhookDeliveryMaintenanceService(deps);
  }

  private constructor(private readonly deps: WebhookDeliveryProcessDeps) {}

  /**
   * Outbox and delivery-log retention, CAS-guarded on a singleton stream row
   * so exactly one pod runs each hourly sweep. The in-process throttle keeps
   * the hot deliver path from probing the row more than once a minute.
   */
  async runIfDue(): Promise<void> {
    const now = (this.deps.now ?? Date.now)();
    if (now - maintenanceLastCheckedMs < 60_000) {
      return;
    }

    maintenanceLastCheckedMs = now;

    // Both sweeps below are global, so the CAS row must be too: a sentinel
    // tenant keeps it one row total, not one per project, and exactly one
    // pod per hour runs the sweeps across the whole install.
    const ref = {
      processName: WEBHOOK_DELIVERY_PROCESS_NAME,
      projectId: MAINTENANCE_TENANT,
      processKey: MAINTENANCE_PROCESS_KEY,
    };
    try {
      const existing = await this.deps.processStore.findByRef<{ lastRunMs: number }>({
        ref,
      });
      if (existing && now - existing.state.lastRunMs < MAINTENANCE_INTERVAL_MS) {
        return;
      }

      const claimed = await this.deps.processStore.commit({
        ref,
        tenantId: MAINTENANCE_TENANT,
        sourceEventId: null,
        expectedRevision: existing?.revision ?? 0,
        state: { lastRunMs: now },
        nextWakeAt: null,
        messages: [],
        now,
      });
      if (claimed.outcome !== "committed") {
        return;
      }

      await this.deps.processStore.deleteDispatchedBefore({
        processName: WEBHOOK_DELIVERY_PROCESS_NAME,
        before: now - OUTBOX_ROW_RETENTION_MS,
      });
      await this.deps.endpoints.pruneDeliveries(new Date(now));
      // Receipts expire lazily, when their key is next presented, so a key that
      // is never retried is never revisited and its row never leaves. The
      // expiresAt index was built for a bulk sweep; this is it.
      await this.deps.pruneExpiredIdempotencyReceipts(new Date(now));
    } catch (error) {
      logger.warn({ error }, "webhook delivery maintenance sweep failed");
    }
  }
}
