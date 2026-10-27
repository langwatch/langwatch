/**
 * Organization's audit outbox (Alex, 2026-10-06): a change appends its audit intent in its own
 * transaction, the outbox records the audit fact, and audit-log writes its row from its side.
 * Spec: modules/audit-log/specs/audit-log.feature
 */
import type { ProcessStore } from "@langwatch/eventing";
import type { OrganizationAuditRecordedEventData } from "@langwatch/organization-contract";

export const ORGANIZATION_AUDIT_PROCESS_NAME = "organizationAudit" as const;
export const ORGANIZATION_AUDIT_RECORD_INTENT = "recordAudit" as const;
export const ORGANIZATION_AUDIT_PRUNE_INTENT = "pruneAudit" as const;
/** The tenant's one audit outbox instance. */
const ORGANIZATION_AUDIT_PROCESS_KEY = "audit";

type AuditIntentAppend = Omit<Parameters<ProcessStore["appendIntents"]>[0], "transaction">;

/** The outbox append that carries one audit fact, keyed by its own audit id. */
export function organizationAuditAppend({
  fact,
}: {
  fact: OrganizationAuditRecordedEventData;
}): AuditIntentAppend {
  return {
    ref: {
      processName: ORGANIZATION_AUDIT_PROCESS_NAME,
      projectId: fact.tenantId,
      processKey: ORGANIZATION_AUDIT_PROCESS_KEY,
    },
    tenantId: fact.tenantId,
    ...(fact.userId === undefined ? {} : { userId: fact.userId }),
    sourceEventId: null,
    messages: [
      {
        messageKey: fact.idempotencyKey,
        intentType: ORGANIZATION_AUDIT_RECORD_INTENT,
        payload: fact,
        traceCarrier: {},
      },
    ],
    now: fact.occurredAt,
  };
}
