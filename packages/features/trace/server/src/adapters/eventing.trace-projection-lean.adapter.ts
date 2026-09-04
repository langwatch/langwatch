import { TraceProjectionLeanService } from "../services/trace-projection-lean.service";
import type { Event, ReplayEvent } from "@langwatch/eventing";
import type { ReplayEventLean } from "@langwatch/eventing/server";

export class TraceProjectionLeanEventingAdapter {
  static create(): TraceProjectionLeanEventingAdapter {
    return new TraceProjectionLeanEventingAdapter();
  }

  /**
   * The lean, in the shape `EventingClickHouseReplayEventSource` takes.
   *
   * Frozen twin of the application's `TraceProjectionLeanEventingAdapter.leanReplayEvent`. Replay's event source
   * lives in `@langwatch/eventing`, which this package depends on, so the
   * substrate cannot import the transform and takes it as a required dependency
   * instead. Composed here, beside the transform, so the two casts across
   * `ReplayEvent`/`Event` exist once rather than at every wiring site — and so a
   * replay wired anywhere leans exactly as live dispatch does (ADR-022).
   */
  static leanReplayEvent: ReplayEventLean = (event) =>
    TraceProjectionLeanService.leanForProjection(
      event as unknown as Event,
    ) as unknown as ReplayEvent;
}
