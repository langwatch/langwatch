import type { IntentSpec, WakeHandler } from "@langwatch/eventing";
import { z } from "zod";

import { realtimeSessionReconciliationConfig } from "../services/gateway-realtime-session-reconciliation.service.ts";

export const GATEWAY_REALTIME_SESSION_RECONCILE_PROCESS_NAME = "gatewayRealtimeSessionReconcile";

/** Once a minute: the vendor's own report closes a session; this settles the ones it never sent. */
export const GATEWAY_REALTIME_SESSION_RECONCILE_INTERVAL_MS =
  realtimeSessionReconciliationConfig.tickIntervalMs;

export const gatewayRealtimeSessionReconcileSchema = z.object({
  scheduledFor: z.number().int(),
});

export interface GatewayRealtimeSessionReconcileState {
  lastReconcileAt: number | null;
}

export const GATEWAY_REALTIME_SESSION_RECONCILE_INITIAL_STATE: GatewayRealtimeSessionReconcileState =
  { lastReconcileAt: null };

export type GatewayRealtimeSessionReconcileIntents = {
  reconcile: IntentSpec<typeof gatewayRealtimeSessionReconcileSchema>;
};

/** Pure and synchronous: the tick itself is an intent, so it runs behind the outbox lease. */
export const gatewayRealtimeSessionReconcileWake: WakeHandler<
  GatewayRealtimeSessionReconcileState,
  GatewayRealtimeSessionReconcileIntents
> = (_state, ctx) => ({
  state: { lastReconcileAt: ctx.at },
  intents: [ctx.intents.reconcile(`reconcile:${ctx.at}`, { scheduledFor: ctx.at })],
});
