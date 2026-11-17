// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type { auditLogIntentSchema } from "@langwatch/audit-log-contract";
import type { IntentSpec, WakeHandler } from "@langwatch/eventing";
import { z } from "zod";

import type { KILL_SWITCH_AUDIT_RECORD_INTENT } from "../rules/kill-switch-audit.rules.ts";

/**
 * The kill switch's audit outbox (the audit outbox rule of modules/audit-log/specs): a request
 * appends its audit intent here and the worker writes it to the audit log, retried and once per
 * key. A daily wake prunes delivered rows. Spec: specs/agent-kill-switch.feature
 */
export const KILL_SWITCH_AUDIT_PRUNE_INTENT = "pruneAudit" as const;
/** An audit row is worth a day of retries; a dead one stays visible on the ops outbox page. */
export const KILL_SWITCH_AUDIT_MAX_ATTEMPTS = 12;
export const KILL_SWITCH_AUDIT_RETENTION_MS = 2 * 24 * 60 * 60 * 1000;
export const KILL_SWITCH_AUDIT_PRUNE_INTERVAL_MS = 24 * 60 * 60 * 1000;

export const killSwitchAuditPruneSchema = z.object({ scheduledFor: z.number().int() });
export const killSwitchAuditStateSchema = z.object({ lastPruneAt: z.number().nullable() });
type KillSwitchAuditState = z.infer<typeof killSwitchAuditStateSchema>;
export const KILL_SWITCH_AUDIT_INITIAL_STATE: KillSwitchAuditState = { lastPruneAt: null };

type KillSwitchAuditIntents = {
  [KILL_SWITCH_AUDIT_RECORD_INTENT]: IntentSpec<typeof auditLogIntentSchema>;
  [KILL_SWITCH_AUDIT_PRUNE_INTENT]: IntentSpec<typeof killSwitchAuditPruneSchema>;
};

export const killSwitchAuditPruneWake: WakeHandler<KillSwitchAuditState, KillSwitchAuditIntents> = (
  _state,
  ctx,
) => ({
  state: { lastPruneAt: ctx.at },
  intents: [
    ctx.intent(KILL_SWITCH_AUDIT_PRUNE_INTENT, `prune:${ctx.at}`, { scheduledFor: ctx.at }),
  ],
});
