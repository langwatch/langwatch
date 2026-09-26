import {
  defineAggregate,
  defineEventingModule,
  definePipeline,
  type Event,
  type EventingSetup,
  type StaticPipelineDefinition,
} from "@langwatch/eventing";

import type { GatewayApp } from "../app/gateway.app.ts";
import {
  type GatewayRealtimeSessionReconcileDeps,
  runGatewayRealtimeSessionReconcile,
} from "./gateway-realtime-session-reconcile.intent.ts";
import {
  GATEWAY_REALTIME_SESSION_RECONCILE_INITIAL_STATE,
  GATEWAY_REALTIME_SESSION_RECONCILE_INTERVAL_MS,
  GATEWAY_REALTIME_SESSION_RECONCILE_PROCESS_NAME,
  type GatewayRealtimeSessionReconcileState,
  gatewayRealtimeSessionReconcileSchema,
  gatewayRealtimeSessionReconcileWake,
} from "./gateway-realtime-session-reconcile.process.ts";

export const GATEWAY_REALTIME_SESSION_PIPELINE_NAME = "gateway_realtime_session_maintenance";

/** The voice reconciler, hosted by the worker like every scheduled process manager. */
export const gatewayRealtimeSessionEventing = defineEventingModule({
  pipeline: GATEWAY_REALTIME_SESSION_PIPELINE_NAME,
  build: ({ app, processStore }: EventingSetup<undefined, GatewayApp>) =>
    buildGatewayRealtimeSessionMaintenancePipeline({
      reconcile: () => app.reconcileRealtimeSessions(),
      deleteDispatchedBefore: (params) => processStore.deleteDispatchedBefore(params),
    }),
});

// Settles brokered voice sessions whose post-call webhook never arrived. No events: the
// sweep spans every tenant, so the aggregate is `global` like the other maintenance pipelines.
export function buildGatewayRealtimeSessionMaintenancePipeline(
  reconcile: GatewayRealtimeSessionReconcileDeps,
): StaticPipelineDefinition<Event> {
  return definePipeline({
    name: GATEWAY_REALTIME_SESSION_PIPELINE_NAME,
    aggregate: defineAggregate({ type: "global" }),
  })
    .withEvents([])
    .withProcessManager(GATEWAY_REALTIME_SESSION_RECONCILE_PROCESS_NAME, (pm) =>
      pm
        .state<GatewayRealtimeSessionReconcileState>(
          GATEWAY_REALTIME_SESSION_RECONCILE_INITIAL_STATE,
        )
        .schedule({ everyMs: GATEWAY_REALTIME_SESSION_RECONCILE_INTERVAL_MS })
        .onWake(gatewayRealtimeSessionReconcileWake)
        .intent(
          "reconcile",
          gatewayRealtimeSessionReconcileSchema,
          runGatewayRealtimeSessionReconcile(reconcile),
        )
        // At most 25 sessions a tick, each one vendor read bounded at 10s.
        .outbox({ leaseDurationMs: 5 * 60 * 1000, maxAttempts: 3 }),
    )
    .build();
}
