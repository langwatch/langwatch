import {
  createOriginGateHandler as createTraceOriginGateHandler,
  TraceDeferredOriginSchedulerPort,
  type DeferredOriginPayload,
} from "@langwatch/trace-server";

export type OriginGateSubscriberDeps = {
  scheduleDeferred(payload: DeferredOriginPayload): Promise<void>;
};

/** Compatibility adapter while Trace callers move to the feature server. */
class LegacyDeferredOriginScheduler extends TraceDeferredOriginSchedulerPort {
  static create(
    scheduleDeferred: (payload: DeferredOriginPayload) => Promise<void>,
  ): LegacyDeferredOriginScheduler {
    return new LegacyDeferredOriginScheduler(scheduleDeferred);
  }

  private constructor(
    private readonly scheduleDeferred: (payload: DeferredOriginPayload) => Promise<void>,
  ) {
    super();
  }

  schedule(payload: DeferredOriginPayload): Promise<void> {
    return this.scheduleDeferred(payload);
  }
}

export function createOriginGateHandler(options: OriginGateSubscriberDeps) {
  return createTraceOriginGateHandler(
    LegacyDeferredOriginScheduler.create((payload) => options.scheduleDeferred(payload)),
  );
}

export {
  createDeferredOriginHandler,
  DEFERRED_ORIGIN_CHECK_DELAY_MS as DEFERRED_CHECK_DELAY_MS,
  makeDeferredOriginJobId as makeDeferredJobId,
  needsOriginResolution,
  ORIGIN_GATE_DEDUP_TTL_MS,
  ORIGIN_GATE_DELAY_MS,
} from "@langwatch/trace-server";
