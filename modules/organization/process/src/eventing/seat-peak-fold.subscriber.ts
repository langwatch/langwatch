import type { EventSubscriberDefinition } from "@langwatch/eventing";

import type { SeatPeakFact } from "../rules/seat-peak.rules.ts";
import {
  SEAT_CHANGED_EVENT_TYPE,
  SEAT_SNAPSHOT_TAKEN_EVENT_TYPE,
  type SeatChangedEvent,
  type SeatSnapshotTakenEvent,
} from "./seat-peak.events.ts";

/** Folds one fact into the organization's stored count, loading only the rows it needs. */
export type SeatPeakFolder = (input: {
  organizationId: string;
  fact: SeatPeakFact;
}) => Promise<void>;

/**
 * organization_seat_peak's fold (ADR-002 §2): per organization, in the order the facts arrive.
 * Idempotent: a redelivered change ties its holder's last change and moves nothing.
 */
export function seatPeakFoldSubscriber(
  fold: SeatPeakFolder,
): EventSubscriberDefinition<SeatChangedEvent | SeatSnapshotTakenEvent> {
  return {
    name: "seatPeakFold",
    eventTypes: [SEAT_CHANGED_EVENT_TYPE, SEAT_SNAPSHOT_TAKEN_EVENT_TYPE],
    handle: async (event) => {
      const fact: SeatPeakFact =
        event.type === SEAT_CHANGED_EVENT_TYPE
          ? { type: "seat_changed", data: event.data }
          : { type: "seat_snapshot_taken", data: event.data };
      await fold({ organizationId: event.data.organizationId, fact });
    },
  };
}
