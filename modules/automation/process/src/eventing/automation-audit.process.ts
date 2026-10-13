/**
 * Automation's audit outbox instance (Alex, Q72): requests append audit intents to it, and its
 * daily wake prunes the delivered rows, as notification's Web Push outbox does.
 */
import type { auditLogIntentSchema } from "@langwatch/audit-log-contract";
import type { IntentSpec, WakeHandler } from "@langwatch/eventing";
import { z } from "zod";

export const AUTOMATION_AUDIT_PROCESS_NAME = "automationAudit" as const;
export const AUTOMATION_AUDIT_RECORD_INTENT = "recordAudit" as const;
export const AUTOMATION_AUDIT_PRUNE_INTENT = "pruneAudit" as const;
/** The project's one audit outbox instance. */
export const AUTOMATION_AUDIT_PROCESS_KEY = "audit";
/** An audit row is worth a day of retries; a dead one stays visible on the ops outbox page. */
export const AUTOMATION_AUDIT_MAX_ATTEMPTS = 12;
/** Delivered intents are kept two days for diagnosis, then pruned daily. */
export const AUTOMATION_AUDIT_RETENTION_MS = 2 * 24 * 60 * 60 * 1000;
export const AUTOMATION_AUDIT_PRUNE_INTERVAL_MS = 24 * 60 * 60 * 1000;

export const automationAuditPruneSchema = z.object({ scheduledFor: z.number().int() });
export const automationAuditStateSchema = z.object({ lastPruneAt: z.number().nullable() });
type AutomationAuditState = z.infer<typeof automationAuditStateSchema>;
export const AUTOMATION_AUDIT_INITIAL_STATE: AutomationAuditState = { lastPruneAt: null };

type AutomationAuditIntents = {
  [AUTOMATION_AUDIT_RECORD_INTENT]: IntentSpec<typeof auditLogIntentSchema>;
  [AUTOMATION_AUDIT_PRUNE_INTENT]: IntentSpec<typeof automationAuditPruneSchema>;
};

export const automationAuditPruneWake: WakeHandler<AutomationAuditState, AutomationAuditIntents> = (
  _state,
  ctx,
) => ({
  state: { lastPruneAt: ctx.at },
  intents: [ctx.intent(AUTOMATION_AUDIT_PRUNE_INTENT, `prune:${ctx.at}`, { scheduledFor: ctx.at })],
});
