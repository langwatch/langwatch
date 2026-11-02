/**
 * What a seat-change intent does once the outbox delivers it: it sends organization's own
 * command, so the change lands as `lw.organization.seat_changed` for the fold (ADR-002).
 */
import type { EventingCommandSender, IntentExecutor } from "@langwatch/eventing";

import type { RecordSeatChangedCommandData } from "./seat-peak.events.ts";

export type SeatPeakSender = Pick<EventingCommandSender<RecordSeatChangedCommandData>, "send">;

/** Sends the change under the id its commit minted; an unconnected sender throws, so it retries. */
export function recordSeatChange(
  sender: () => SeatPeakSender | undefined,
): IntentExecutor<RecordSeatChangedCommandData> {
  return async (change) => {
    const connected = sender();
    if (!connected) throw new Error("organization_seat_peak is not registered in this process");
    await connected.send(change);
  };
}
