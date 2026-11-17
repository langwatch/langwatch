// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type { AuditLogIntent } from "@langwatch/audit-log-contract";

export const KILL_SWITCH_AUDIT_PROCESS_NAME = "killSwitchAudit" as const;
export const KILL_SWITCH_AUDIT_RECORD_INTENT = "recordAudit" as const;
/** The organisation's one audit outbox instance. */
const KILL_SWITCH_AUDIT_PROCESS_KEY = "kill-switch-audit";

type KillSwitchAuditAppend = {
  ref: { processName: string; projectId: string; processKey: string };
  tenantId: string;
  userId?: string;
  sourceEventId: null;
  messages: {
    messageKey: string;
    intentType: string;
    payload: AuditLogIntent;
    traceCarrier: Record<string, string>;
  }[];
};

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
