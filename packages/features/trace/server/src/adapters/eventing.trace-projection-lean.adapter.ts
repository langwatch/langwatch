import { TraceProjectionLeanService } from "../services/trace-projection-lean.service";
import type { Event, ReplayEvent } from "@langwatch/eventing";
import type { ReplayEventLean } from "@langwatch/eventing/server";

export class TraceProjectionLeanEventingAdapter {
  static create(): TraceProjectionLeanEventingAdapter {
    return new TraceProjectionLeanEventingAdapter();
  }

  /**
   * @see ADR-022
   * The lean, shaped for EventingClickHouseReplayEventSource — a frozen twin of TraceProjectionLeanEventingAdapter.leanReplayEvent. Replay's event source lives in @langwatch/eventing, which this package depends on, so the substrate can't import the transform and takes it as a required dependency instead, composed here so the ReplayEvent/Event casts exist once and a replay wired anywhere leans exactly as live dispatch does.
   */
  static leanReplayEvent: ReplayEventLean = (event) =>
    TraceProjectionLeanService.leanForProjection(
      event as unknown as Event,
    ) as unknown as ReplayEvent;
}
