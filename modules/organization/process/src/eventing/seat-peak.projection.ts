import {
  AbstractFoldProjection,
  type FoldEventHandlers,
  type StateProjectionStore,
} from "@langwatch/eventing";

import { emptySeatPeak, foldSeatPeak, type SeatPeakState } from "../rules/seat-peak.rules.ts";
import {
  type SeatChangedEvent,
  seatChangedEventSchema,
  type SeatSnapshotTakenEvent,
  seatSnapshotTakenEventSchema,
} from "./seat-peak.events.ts";

const SEAT_PEAK_PROJECTION_NAME = "seatPeakState" as const;
const SEAT_PEAK_PROJECTION_VERSION = "2026-11-02";

const seatPeakEvents = [seatChangedEventSchema, seatSnapshotTakenEventSchema] as const;

/** The fold's state plus the base class's bookkeeping stamps, outside the pure fold. */
export type SeatPeakFoldState = SeatPeakState & {
  CreatedAt: number;
  UpdatedAt: number;
  LastEventOccurredAt: number;
};

/**
 * organization_seat_peak's projection (ADR-002 §2): one row per organization, folded in order by
 * the pure rule in `rules/seat-peak.rules.ts`. It never reads the memberships table.
 */
export class SeatPeakFoldProjection
  extends AbstractFoldProjection<
    SeatPeakFoldState,
    typeof seatPeakEvents,
    "CreatedAt",
    "UpdatedAt",
    "LastEventOccurredAt",
    StateProjectionStore<SeatPeakFoldState>
  >
  implements FoldEventHandlers<typeof seatPeakEvents, SeatPeakFoldState>
{
  readonly name = SEAT_PEAK_PROJECTION_NAME;
  readonly version = SEAT_PEAK_PROJECTION_VERSION;
  readonly store: StateProjectionStore<SeatPeakFoldState>;

  protected readonly events = seatPeakEvents;

  static create(deps: { store: StateProjectionStore<SeatPeakFoldState> }): SeatPeakFoldProjection {
    return new SeatPeakFoldProjection(deps);
  }

  constructor(deps: { store: StateProjectionStore<SeatPeakFoldState> }) {
    super();
    this.store = deps.store;
  }

  protected initState(): SeatPeakState {
    return emptySeatPeak();
  }

  handleOrganizationSeatChanged(
    event: SeatChangedEvent,
    state: SeatPeakFoldState,
  ): SeatPeakFoldState {
    return {
      ...state,
      ...foldSeatPeak({ state, fact: { type: "seat_changed", data: event.data } }),
    };
  }

  handleOrganizationSeatSnapshotTaken(
    event: SeatSnapshotTakenEvent,
    state: SeatPeakFoldState,
  ): SeatPeakFoldState {
    return {
      ...state,
      ...foldSeatPeak({ state, fact: { type: "seat_snapshot_taken", data: event.data } }),
    };
  }
}
