// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type { AuditLogApi, AuditLogIntent } from "@langwatch/audit-log-contract";
import type { ProcessStore } from "@langwatch/eventing";
import { nowInstant } from "@langwatch/time";

import type { KillSwitchAuditOutbox } from "../services/kill-switch-audit.service.ts";
import {
  KILL_SWITCH_AUDIT_PROCESS_KEY,
  KILL_SWITCH_AUDIT_PROCESS_NAME,
  KILL_SWITCH_AUDIT_RECORD_INTENT,
  KILL_SWITCH_AUDIT_RETENTION_MS,
} from "./kill-switch-audit.process.ts";

/** The worker's side: deliver one recorded intent; its key makes a redelivery write nothing. */
export function recordKillSwitchAudit(
  auditLog: Pick<AuditLogApi, "record">,
): (intent: AuditLogIntent) => Promise<void> {
  return async (intent) => {
    await auditLog.record(intent);
  };
}

/** The daily prune of delivered audit intents. */
export function pruneKillSwitchAudits(
  retention: Pick<ProcessStore, "deleteDispatchedBefore">,
): () => Promise<void> {
  return async () => {
    await retention.deleteDispatchedBefore({
      processName: KILL_SWITCH_AUDIT_PROCESS_NAME,
      before: nowInstant().epochMilliseconds - KILL_SWITCH_AUDIT_RETENTION_MS,
    });
  };
}

/** The request's side: the audit intent appended to governance's own outbox under its key. */
export class OutboxKillSwitchAudit implements KillSwitchAuditOutbox {
  static create(processStore: Pick<ProcessStore, "appendIntents">): OutboxKillSwitchAudit {
    return new OutboxKillSwitchAudit(processStore);
  }

  private constructor(private readonly processStore: Pick<ProcessStore, "appendIntents">) {}

  async record(intent: AuditLogIntent): Promise<void> {
    const tenantId = intent.organizationId ?? intent.projectId;
    if (!tenantId) throw new Error("a kill switch audit intent names its organisation");
    await this.processStore.appendIntents({
      ref: {
        processName: KILL_SWITCH_AUDIT_PROCESS_NAME,
        projectId: tenantId,
        processKey: KILL_SWITCH_AUDIT_PROCESS_KEY,
      },
      tenantId,
      ...(intent.userId ? { userId: intent.userId } : {}),
      sourceEventId: null,
      messages: [
        {
          messageKey: intent.idempotencyKey,
          intentType: KILL_SWITCH_AUDIT_RECORD_INTENT,
          payload: intent,
          traceCarrier: {},
        },
      ],
      now: nowInstant().epochMilliseconds,
    });
  }
}
