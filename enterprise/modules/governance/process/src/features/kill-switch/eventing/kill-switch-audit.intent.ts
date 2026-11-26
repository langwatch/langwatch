// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type { AuditLogApi, AuditLogIntent } from "@langwatch/audit-log-contract";
import type { ProcessStore } from "@langwatch/eventing";
import { nowInstant } from "@langwatch/time";

import {
  KILL_SWITCH_AUDIT_PROCESS_NAME,
  killSwitchAuditAppend,
} from "../rules/kill-switch-audit.rules.ts";
import type { KillSwitchAuditOutbox } from "../services/kill-switch-audit.service.ts";
import { KILL_SWITCH_AUDIT_RETENTION_MS } from "./kill-switch-audit.process.ts";

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
    await this.processStore.appendIntents({
      ...killSwitchAuditAppend(intent),
      now: nowInstant().epochMilliseconds,
    });
  }
}
