/**
 * What a seat-change intent does once the outbox delivers it: it sends organization's own
 * command, so the change lands as `lw.organization.seat_changed` for the fold (ADR-002).
 */
import type { EventingCommandSender, IntentExecutor, ProcessStore } from "@langwatch/eventing";
import { nowInstant } from "@langwatch/time";

import { SEAT_PEAK_PROCESS_NAME } from "../rules/seat-change.rules.ts";
import type { RecordSeatChangedCommandData } from "./seat-peak.events.ts";
import { SEAT_PEAK_RETENTION_MS } from "./seat-peak.process.ts";

export type SeatPeakSender = Pick<EventingCommandSender<RecordSeatChangedCommandData>, "send">;

/**
 * Sends the change under the id its commit minted. The getter is the app's
 * `getSeatChangeSender`, which throws until organization_seat_peak registers, so it retries.
 */
export function recordSeatChanged(
  sender: () => SeatPeakSender,
): IntentExecutor<RecordSeatChangedCommandData> {
  return async (change) => {
    await sender().send(change);
  };
}

/** The daily prune of delivered seat changes. */
export function pruneSeatChangeIntents(
  retention: Pick<ProcessStore, "deleteDispatchedBefore">,
): () => Promise<void> {
  return async () => {
    await retention.deleteDispatchedBefore({
      processName: SEAT_PEAK_PROCESS_NAME,
      before: nowInstant().epochMilliseconds - SEAT_PEAK_RETENTION_MS,
    });
  };
}
