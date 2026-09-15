import { TraceProjectionLeanService } from "./projection/trace-projection-lean.service.ts";
import type { Event, ReplayEvent } from "@langwatch/eventing";
import type { ReplayEventLean } from "@langwatch/eventing/server";

export class TraceProjectionLeanEventingAdapter {
  static create(): TraceProjectionLeanEventingAdapter {
    return new TraceProjectionLeanEventingAdapter();
  }

  /**
   * @see ADR-022: Frozen lean twin for EventingClickHouseReplayEventSource; casts live
   * here so replay and live dispatch lean identically.
   */
  static leanReplayEvent: ReplayEventLean = (event) =>
    TraceProjectionLeanService.leanForProjection(
      event as unknown as Event,
    ) as unknown as ReplayEvent;
}
