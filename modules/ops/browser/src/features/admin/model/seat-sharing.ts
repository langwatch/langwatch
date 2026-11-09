/**
 * How the Cloud admin seat use page (/ops/cloud/seat-use) reads the seat sharing check.
 * Spec: modules/ops/specs/seat-sharing-check.feature
 */
import type { SeatSharingCheck, SeatSharingReading } from "@langwatch/ops-contract";

export type { SeatSharingCheck, SeatSharingReading };

/** The two ways the list can be narrowed by the check. */
export const SEAT_SHARING_FILTERS = ["all", "over"] as const;
export type SeatSharingFilter = (typeof SEAT_SHARING_FILTERS)[number];

/** Each reading by organization id, for the rows of one page. */
export function readingsByOrganization(
  check: SeatSharingCheck | undefined,
): ReadonlyMap<string, SeatSharingReading> {
  return new Map((check?.readings ?? []).map((reading) => [reading.organizationId, reading]));
}

/** The flagged organizations' ids, which the "Over 2x seats" filter asks the list for. */
export function flaggedOrganizationIds(check: SeatSharingCheck | undefined): string[] {
  return (check?.readings ?? [])
    .filter((reading) => reading.flagged)
    .map((reading) => reading.organizationId);
}

/** "12 people on 5 seats", singular where it is one. */
export function peopleOnSeats(reading: SeatSharingReading): string {
  const people = reading.activePeople === 1 ? "person" : "people";
  const seats = reading.seats === 1 ? "seat" : "seats";
  return `${reading.activePeople} ${people} on ${reading.seats} ${seats}`;
}

/** The chip's ratio, one decimal: "2.4x". */
export function sharingRatio(reading: SeatSharingReading): string {
  if (reading.seats === 0) return "no seats";
  return `${(reading.activePeople / reading.seats).toFixed(1)}x`;
}
