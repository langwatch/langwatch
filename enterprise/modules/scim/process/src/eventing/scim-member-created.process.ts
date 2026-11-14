// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * SCIM's member-created outbox instance: a directory create appends its fact in its own
 * transaction, and the daily wake prunes the delivered rows, as organization's seat outbox does.
 */
import type { IntentSpec, WakeHandler } from "@langwatch/eventing";
import { z } from "zod";

import {
  SCIM_MEMBERSHIP_PRUNE_INTENT,
  type SCIM_MEMBER_CREATED_INTENT,
} from "../rules/scim-member-created.rules.ts";
import type { recordMemberCreatedCommandDataSchema } from "./scim-member-created.events.ts";

/** A day of retries; a dead fact stays visible on the ops outbox page. */
export const SCIM_MEMBERSHIP_MAX_ATTEMPTS = 12;
/** Delivered facts are kept two days for diagnosis, then pruned daily. */
export const SCIM_MEMBERSHIP_RETENTION_MS = 2 * 24 * 60 * 60 * 1000;
export const SCIM_MEMBERSHIP_PRUNE_INTERVAL_MS = 24 * 60 * 60 * 1000;

export const scimMembershipPruneSchema = z.object({ scheduledFor: z.number().int() });
export const scimMembershipProcessStateSchema = z.object({ lastPruneAt: z.number().nullable() });
type ScimMembershipProcessState = z.infer<typeof scimMembershipProcessStateSchema>;
export const SCIM_MEMBERSHIP_PROCESS_INITIAL_STATE: ScimMembershipProcessState = {
  lastPruneAt: null,
};

type ScimMembershipIntents = {
  [SCIM_MEMBER_CREATED_INTENT]: IntentSpec<typeof recordMemberCreatedCommandDataSchema>;
  [SCIM_MEMBERSHIP_PRUNE_INTENT]: IntentSpec<typeof scimMembershipPruneSchema>;
};

export const scimMembershipPruneWake: WakeHandler<
  ScimMembershipProcessState,
  ScimMembershipIntents
> = (_state, ctx) => ({
  state: { lastPruneAt: ctx.at },
  intents: [ctx.intent(SCIM_MEMBERSHIP_PRUNE_INTENT, `prune:${ctx.at}`, { scheduledFor: ctx.at })],
});
