// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type { IntentSpec, WakeHandler } from "@langwatch/eventing";
import { z } from "zod";

/** Four times a day: the log never runs more than six hours past its window. */
export const SCIM_REQUEST_LOG_RETENTION_INTERVAL_MS = 6 * 60 * 60 * 1000;

export const scimRequestLogRetentionSchema = z.object({
  scheduledFor: z.number().int(),
});

export const scimRequestLogRetentionStateSchema = z.object({
  lastSweepAt: z.number().nullable(),
});
export type ScimRequestLogRetentionState = z.infer<typeof scimRequestLogRetentionStateSchema>;

export const SCIM_REQUEST_LOG_RETENTION_INITIAL_STATE: ScimRequestLogRetentionState = {
  lastSweepAt: null,
};

export type ScimRequestLogRetentionIntents = {
  sweep: IntentSpec<typeof scimRequestLogRetentionSchema>;
};

/** Pure and synchronous; the delete itself runs behind the outbox lease. */
export const scimRequestLogRetentionWake: WakeHandler<
  ScimRequestLogRetentionState,
  ScimRequestLogRetentionIntents
> = (_state, ctx) => ({
  state: { lastSweepAt: ctx.at },
  intents: [ctx.intent("sweep", `sweep:${ctx.at}`, { scheduledFor: ctx.at })],
});
