/**
 * The shape of the invented seat counts.
 *
 * Sample data earns its place by modelling how the real thing behaves, and
 * seats were modelled wrong: bought and assigned were generated as a near
 * constant ratio of one another, so both lines rose together quarter after
 * quarter. Nobody buys licences that way. A contract is signed once, the
 * seats are paid for before a single person has been given one, and
 * assignment catches up over the following quarters.
 *
 * The gap between the two lines is the idle spend the panel exists to show.
 * As a constant ratio it read as a fixed overhead nobody can act on; drawn
 * truthfully it reads as a spike at renewal that an organization works off,
 * which is the thing an admin opened the panel to see.
 *
 * The months are written out rather than taken from the clock: the whole
 * point is what happens either side of a January, and a test that asked for
 * "the last twelve months" would only cross one for part of the year.
 *
 * Spec: specs/governance/governance-cost-screen.feature
 */
import { describe, expect, it } from "vitest";

import { sampleCostSummary } from "../sampleLanes";
import { sampleSeatPools, sampleSeats } from "../sampleSeries";

/** Two calendar years of months, so the window spans exactly one renewal. */
const MONTHS = [
  "2025-09-01",
  "2025-10-01",
  "2025-11-01",
  "2025-12-01",
  "2026-01-01",
  "2026-02-01",
  "2026-03-01",
  "2026-06-01",
  "2026-09-01",
  "2026-12-01",
];

const RENEWAL = "2026-01-01";

const boughtOn = (day: string) =>
  sampleSeatPools(day).reduce((sum, pool) => sum + pool.seatsBought, 0);
const assignedOn = (day: string) =>
  sampleSeatPools(day).reduce((sum, pool) => sum + pool.seatsAssigned, 0);

describe("the invented seat counts", () => {
  /** @scenario "Seats bought step up at renewal and hold flat until the next one" */
  it("changes the bought count only at the renewal month, and never downward", () => {
    const changes = MONTHS.slice(1).filter(
      (day, index) => boughtOn(day) !== boughtOn(MONTHS[index] ?? ""),
    );

    expect(changes).toEqual([RENEWAL]);
    // Never falls: a company does not hand licences back mid-contract, and a
    // bought line that dipped would read as a defect in the read.
    for (const [index, day] of MONTHS.slice(1).entries()) {
      expect(boughtOn(day)).toBeGreaterThanOrEqual(
        boughtOn(MONTHS[index] ?? ""),
      );
    }
  });

  /** @scenario "Seats assigned climb from the floor after a renewal" */
  it("drops assignment at the renewal and climbs back across the year", () => {
    const beforeRenewal = "2025-12-01";
    const share = (day: string) => assignedOn(day) / boughtOn(day);

    // The renewal buys seats nobody has been given yet, so the share assigned
    // falls even though the count of assigned seats has not.
    expect(share(RENEWAL)).toBeLessThan(share(beforeRenewal) - 0.3);

    const acrossTheYear = [
      "2026-01-01",
      "2026-03-01",
      "2026-06-01",
      "2026-09-01",
      "2026-12-01",
    ];
    for (const [index, day] of acrossTheYear.slice(1).entries()) {
      expect(share(day)).toBeGreaterThan(share(acrossTheYear[index] ?? ""));
    }

    // Never above bought, at any month: a provider cannot seat more people
    // than the licences paid for.
    for (const day of MONTHS) {
      expect(assignedOn(day)).toBeLessThanOrEqual(boughtOn(day));
    }
  });

  /** @scenario "The seat lane and the seat chart report the same month alike" */
  it("gives the lane card and the chart the same counts for the same month", () => {
    const lane = sampleCostSummary(MONTHS).seats;
    const chart = sampleSeats(MONTHS);
    const lastBar = chart[chart.length - 1];
    const valueOf = (key: string) =>
      lastBar?.points.find((point) => point.key === key)?.value ?? 0;

    // The lane lists pools and the chart sums them, so the comparison is the
    // sum — but both must be answering about the same month, which is what
    // this catches if either side ever picks a different one.
    if (lane.status !== "reported") throw new Error("the sample lane reports");
    const laneBought = lane.pools.reduce(
      (sum, pool) => sum + pool.seatsBought,
      0,
    );
    const laneAssigned = lane.pools.reduce(
      (sum, pool) => sum + pool.seatsAssigned,
      0,
    );

    expect(laneBought).toBe(valueOf("bought"));
    expect(laneAssigned).toBe(valueOf("assigned"));
  });
});
