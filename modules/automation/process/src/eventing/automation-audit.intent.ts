/**
 * Automation's audit outbox (Alex, Q72): a request records its audit intent here and the worker's
 * outbox writes it to the audit log after commit, retried and written once per key.
 * Spec: modules/audit-log/specs/audit-log.feature (the audit outbox rule).
 */
import type { AuditLogApi, AuditLogIntent } from "@langwatch/audit-log-contract";
import type { ProcessStore } from "@langwatch/eventing";
import { generate } from "@langwatch/ksuid";
import { nowInstant } from "@langwatch/time";
import { z } from "zod";

import type { AutomationAuditSink } from "../app/automation.app.ts";
import type { AutomationIntentRetentionRepository } from "../repositories/automation-intent-retention.repository.ts";
import {
  AUTOMATION_AUDIT_PROCESS_KEY,
  AUTOMATION_AUDIT_PROCESS_NAME,
  AUTOMATION_AUDIT_RECORD_INTENT,
  AUTOMATION_AUDIT_RETENTION_MS,
} from "./automation-audit.process.ts";

/** The worker's side: deliver one recorded intent; the key makes a redelivery a no-op. */
export function recordAuditIntent(
  auditLog: AuditLogApi,
): (intent: AuditLogIntent) => Promise<void> {
  return async (intent) => {
    await auditLog.record(intent);
  };
}

/** The daily prune of delivered audit intents. */
export function pruneAuditIntents(
  retention: AutomationIntentRetentionRepository,
): () => Promise<void> {
  return async () => {
    await retention.deleteDispatchedBefore({
      processName: AUTOMATION_AUDIT_PROCESS_NAME,
      before: nowInstant().epochMilliseconds - AUTOMATION_AUDIT_RETENTION_MS,
    });
  };
}

/** The request's side: the audit intent, keyed once, appended to automation's own outbox. */
export class OutboxAutomationAuditSink implements AutomationAuditSink {
  static create(processStore: Pick<ProcessStore, "appendIntents">): OutboxAutomationAuditSink {
    return new OutboxAutomationAuditSink(processStore);
  }

  private constructor(private readonly processStore: Pick<ProcessStore, "appendIntents">) {}

  async record(entry: Parameters<AutomationAuditSink["record"]>[0]): Promise<void> {
    const idempotencyKey = generate("audit").toString();
    const payload = {
      idempotencyKey,
      userId: entry.userId,
      projectId: entry.projectId,
      action: entry.action,
      ...(entry.args === undefined ? {} : { args: z.json().parse(entry.args) }),
    } satisfies AuditLogIntent;
    await this.processStore.appendIntents({
      ref: {
        processName: AUTOMATION_AUDIT_PROCESS_NAME,
        projectId: entry.projectId,
        processKey: AUTOMATION_AUDIT_PROCESS_KEY,
      },
      tenantId: entry.projectId,
      userId: entry.userId,
      sourceEventId: null,
      messages: [
        {
          messageKey: idempotencyKey,
          intentType: AUTOMATION_AUDIT_RECORD_INTENT,
          payload,
          traceCarrier: {},
        },
      ],
      now: nowInstant().epochMilliseconds,
    });
  }
}
