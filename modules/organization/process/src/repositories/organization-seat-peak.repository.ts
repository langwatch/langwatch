import type {
  ProjectionStoreContext,
  StateProjectionStore,
  StoredProjection,
  StoredProjectionRead,
} from "@langwatch/eventing";
import { z } from "zod";

import { type SeatPeakState, seatPeakStateSchema } from "../rules/seat-peak.rules.ts";

/** The fold's state as stored: the pure state plus the fold base class's bookkeeping stamps. */
export const seatPeakFoldStateSchema = z.object({
  ...seatPeakStateSchema.shape,
  CreatedAt: z.number(),
  UpdatedAt: z.number(),
  LastEventOccurredAt: z.number(),
});
export type SeatPeakFoldState = z.infer<typeof seatPeakFoldStateSchema>;

/**
 * The seat-peak fold's row per organization (ADR-002): written by the projection, read by the
 * seat-peak service. Rebuildable from the event log, which a change to the state's shape needs.
 */
export abstract class OrganizationSeatPeakRepository implements StateProjectionStore<SeatPeakFoldState> {
  abstract get(
    organizationId: string,
    context: ProjectionStoreContext,
  ): Promise<StoredProjectionRead<SeatPeakFoldState>>;

  abstract store(
    projection: StoredProjection<SeatPeakFoldState>,
    context: ProjectionStoreContext,
  ): Promise<void>;

  /**
   * The organization's folded state; before its first event was folded, the empty state, whose
   * `openedAt` is null (counting has not started). An unreadable row throws.
   */
  abstract getState(organizationId: string): Promise<SeatPeakState>;
}
