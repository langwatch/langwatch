/**
 * NOT WIRED — nothing mounts this applier, and this file is inert.
 *
 * The live path is still `../reactors/originGate.reactor.ts`, built in
 * `pipelineRegistry.registerTracePipeline()` against a `scheduleDeferred`
 * `Deferred` and mounted by `trace-processing/pipeline.ts` as
 * `.withReactor("traceSummary", "originGate", deps.originGateReactor)`. The
 * deferred re-check therefore still runs on a delayed reactor job, not on a
 * durable process deadline.
 *
 * It stays inert because ADR-077 has not reached trace-processing yet (it is
 * migration step 7, last): mounting it means the pipeline owning its own
 * `.withProcessManager(ORIGIN_GATE_PROCESS_NAME, originGatePM(deps.dispatch))`
 * and binding `resolveOrigin` through the command bus, which is exactly what
 * step 7 does. The reactor and the `Deferred` go in that same change.
 */

import type { ProcessManagerApplier } from "~/server/event-sourcing/pipeline/processBuilder";

import {
  LOG_CONTRIBUTED_EVENT_TYPE,
  LOG_RECORD_RECEIVED_EVENT_TYPE,
  ORIGIN_RESOLVED_EVENT_TYPE,
  SPAN_RECEIVED_EVENT_TYPE,
} from "../schemas/constants";
import type { TraceProcessingEvent } from "../schemas/events";
import {
  buildProcessEventView,
  handleOriginResolved,
  handleTraceActivity,
  originGateWake,
} from "./originGate.process";
import {
  createOriginGateResolveHandler,
  type OriginGateDispatchDeps,
} from "./originGateIntentHandlers";
import {
  INITIAL_ORIGIN_GATE_STATE,
  ORIGIN_GATE_INTENT_TYPES,
  ORIGIN_GATE_LEASE_DURATION_MS,
  ORIGIN_GATE_MAX_ATTEMPTS,
  originGateResolveIntentSchema,
} from "./originGateProcess.types";

/**
 * The `originGate` process-manager topology, exported standalone so the
 * pipeline mounts one expression of it and tests can build the exact
 * definition the runtime runs.
 *
 * The declared event set is narrower than the reactor's, which fired on every
 * event the traceSummary fold handled. Spans and log contributions are the
 * only things that can leave a trace without an origin, and `origin_resolved`
 * is the only thing that settles it; a topic assignment, an annotation or a
 * rename arrives on a trace that already exists and decides nothing about
 * where it came from. Every event type declared here costs a durable
 * transition per trace, so the set is the question the process actually asks.
 */
export function originGatePM(
  dispatch: OriginGateDispatchDeps,
): ProcessManagerApplier<TraceProcessingEvent> {
  return (pm) =>
    pm
      .state(INITIAL_ORIGIN_GATE_STATE)
      .intent(
        ORIGIN_GATE_INTENT_TYPES.RESOLVE_ORIGIN,
        originGateResolveIntentSchema,
        createOriginGateResolveHandler(dispatch),
      )
      .on(SPAN_RECEIVED_EVENT_TYPE, handleTraceActivity)
      .on(LOG_RECORD_RECEIVED_EVENT_TYPE, handleTraceActivity)
      .on(LOG_CONTRIBUTED_EVENT_TYPE, handleTraceActivity)
      .on(ORIGIN_RESOLVED_EVENT_TYPE, handleOriginResolved)
      .onWake(originGateWake)
      .toPayload(buildProcessEventView)
      .outbox({
        maxAttempts: ORIGIN_GATE_MAX_ATTEMPTS,
        leaseDurationMs: ORIGIN_GATE_LEASE_DURATION_MS,
      });
}
