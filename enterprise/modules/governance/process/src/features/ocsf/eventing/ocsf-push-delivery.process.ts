// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type { IntentSpec, WakeHandler } from "@langwatch/eventing";
import { z } from "zod";

/**
 * The OCSF SIEM push outbox (ADR-167 Decision 1, as the agent registry does): one intent per written
 * event and subscribed endpoint, whose handler asks WebhookApi.requestDelivery; the webhook module
 * batches the sends. A daily wake prunes delivered rows.
 * Spec: enterprise/modules/governance/specs/ocsf-siem.feature
 */
export const OCSF_PUSH_PROCESS_NAME = "ocsfSiemPush" as const;
export const OCSF_PUSH_REQUEST_INTENT = "requestDelivery" as const;
export const OCSF_PUSH_PRUNE_INTENT = "pruneDelivered" as const;
export const OCSF_PUSH_PROCESS_KEY = "ocsf-siem-push";
/** A requestDelivery answers at once; the webhook module retries the HTTP send itself. */
export const OCSF_PUSH_MAX_ATTEMPTS = 12;
export const OCSF_PUSH_RETENTION_MS = 2 * 24 * 60 * 60 * 1000;
export const OCSF_PUSH_PRUNE_INTERVAL_MS = 24 * 60 * 60 * 1000;

export const ocsfPushIntentSchema = z.object({
  organizationId: z.string().min(1),
  endpointId: z.string().min(1),
  /** The governance event id: the same event written again repeats it. */
  eventId: z.string().min(1),
  body: z.record(z.string(), z.unknown()),
});
export type OcsfPushIntent = z.infer<typeof ocsfPushIntentSchema>;

export const ocsfPushPruneSchema = z.object({ scheduledFor: z.number().int() });
export const ocsfPushStateSchema = z.object({ lastPruneAt: z.number().nullable() });
type OcsfPushState = z.infer<typeof ocsfPushStateSchema>;
export const OCSF_PUSH_INITIAL_STATE: OcsfPushState = { lastPruneAt: null };

type OcsfPushIntents = {
  [OCSF_PUSH_REQUEST_INTENT]: IntentSpec<typeof ocsfPushIntentSchema>;
  [OCSF_PUSH_PRUNE_INTENT]: IntentSpec<typeof ocsfPushPruneSchema>;
};

/** One key per event and endpoint: the outbox's dedup identity and the webhook's idempotency key. */
export function ocsfPushDeliveryKey({
  eventId,
  endpointId,
}: {
  eventId: string;
  endpointId: string;
}): string {
  return `ocsf:${eventId}:${endpointId}`;
}

export const ocsfPushPruneWake: WakeHandler<OcsfPushState, OcsfPushIntents> = (_state, ctx) => ({
  state: { lastPruneAt: ctx.at },
  intents: [ctx.intent(OCSF_PUSH_PRUNE_INTENT, `prune:${ctx.at}`, { scheduledFor: ctx.at })],
});
