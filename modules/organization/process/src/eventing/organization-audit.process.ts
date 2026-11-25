/**
 * Organization's audit outbox instance (Alex, 2026-10-06): changes append audit intents to it in
 * their own transaction, and its daily wake prunes the delivered rows, as automation's does.
 */
import type { IntentSpec, WakeHandler } from "@langwatch/eventing";
import { z } from "zod";

import {
  ORGANIZATION_AUDIT_PRUNE_INTENT,
  type ORGANIZATION_AUDIT_RECORD_INTENT,
} from "../rules/organization-audit.rules.ts";
import type { recordAuditCommandDataSchema } from "./organization-audit.commands.ts";

/** An audit row is worth a day of retries; a dead one stays visible on the ops outbox page. */
export const ORGANIZATION_AUDIT_MAX_ATTEMPTS = 12;
/** Delivered intents are kept two days for diagnosis, then pruned daily. */
export const ORGANIZATION_AUDIT_RETENTION_MS = 2 * 24 * 60 * 60 * 1000;
export const ORGANIZATION_AUDIT_PRUNE_INTERVAL_MS = 24 * 60 * 60 * 1000;

export const organizationAuditPruneSchema = z.object({ scheduledFor: z.number().int() });
export const organizationAuditStateSchema = z.object({ lastPruneAt: z.number().nullable() });
type OrganizationAuditState = z.infer<typeof organizationAuditStateSchema>;
export const ORGANIZATION_AUDIT_INITIAL_STATE: OrganizationAuditState = { lastPruneAt: null };

type OrganizationAuditIntents = {
  [ORGANIZATION_AUDIT_RECORD_INTENT]: IntentSpec<typeof recordAuditCommandDataSchema>;
  [ORGANIZATION_AUDIT_PRUNE_INTENT]: IntentSpec<typeof organizationAuditPruneSchema>;
};

export const organizationAuditPruneWake: WakeHandler<
  OrganizationAuditState,
  OrganizationAuditIntents
> = (_state, ctx) => ({
  state: { lastPruneAt: ctx.at },
  intents: [
    ctx.intent(ORGANIZATION_AUDIT_PRUNE_INTENT, `prune:${ctx.at}`, { scheduledFor: ctx.at }),
  ],
});
