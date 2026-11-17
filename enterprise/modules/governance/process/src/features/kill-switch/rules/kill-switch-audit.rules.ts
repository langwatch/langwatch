// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type { AuditLogIntent } from "@langwatch/audit-log-contract";
import type { ProcessStore } from "@langwatch/eventing";

import {
  KILL_SWITCH_AUDIT_PROCESS_KEY,
  KILL_SWITCH_AUDIT_PROCESS_NAME,
  KILL_SWITCH_AUDIT_RECORD_INTENT,
} from "../eventing/kill-switch-audit.process.ts";

type KillSwitchAuditAppend = Omit<
  Parameters<ProcessStore["appendIntents"]>[0],
  "transaction" | "now"
>;

/** The outbox append of one kill switch audit intent, under its own key; the caller adds `now`. */
export function killSwitchAuditAppend(intent: AuditLogIntent): KillSwitchAuditAppend {
  const tenantId = intent.organizationId ?? intent.projectId;
  if (!tenantId) throw new Error("a kill switch audit intent names its organisation");
  return {
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
  };
}
