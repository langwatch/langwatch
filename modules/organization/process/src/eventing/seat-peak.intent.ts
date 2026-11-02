/**
 * What a seat-change intent does once the outbox delivers it: it sends organization's own
 * command, so the change lands as `lw.organization.seat_changed` for the fold (ADR-002).
 */
import type { EventingCommandSender, IntentExecutor } from "@langwatch/eventing";

import type { RecordSeatChangedCommandData } from "./seat-peak.events.ts";

export type SeatPeakSender = Pick<EventingCommandSender<RecordSeatChangedCommandData>, "send">;

/**
 * Sends the change under the id its commit minted. The getter is the app's
 * `getSeatChangeSender`, which throws until organization_seat_peak registers, so it retries.
 */
export function recordSeatChange(
  sender: () => SeatPeakSender,
): IntentExecutor<RecordSeatChangedCommandData> {
  return async (change) => {
    await sender().send(change);
  };
}
