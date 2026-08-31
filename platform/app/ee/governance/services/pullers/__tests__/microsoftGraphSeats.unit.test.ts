// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * Reading a tenant's licence list, and deciding what the next run asks for
 * when this one could not read it.
 *
 * The classification rules below are not invented: they are what a live run
 * against a real tenant needed to turn 27 apparently unused seats into the 2
 * that were really unused. A 25-unit company-wide pool nobody can be assigned
 * and a 10,000-unit free pool were the whole difference, and each of them
 * produces a loud, plausible, wrong finding on its own.
 *
 * The facts are carried INDEPENDENTLY rather than as one label, because a pool
 * can be free and company-wide and suspended at the same time — the live
 * tenant had pools that were two of those at once.
 *
 * Spec: specs/governance/pulled-seats.feature
 */
import { describe, expect, it } from "vitest";

import {
  microsoftSeatEvents,
  nextSeatsCursor,
  readSubscribedSkuRows,
  SEAT_REPORT_ACTION,
  SEATS_MAX_HOLD_MS,
  type SubscribedSku,
  seatsReadIsDue,
  seatsReportDay,
} from "../microsoftGraphSeats";

const DAY = "2026-08-30";
const NOW_MS = Date.parse("2026-08-30T09:00:00.000Z");

/**
 * A live, paid, per-person agent seat pool — the only kind that counts.
 *
 * Field casing is Microsoft's own: `appliesTo` is "User" or "Company",
 * `capabilityStatus` is "Enabled", "Warning" or "Suspended". Every test that
 * varies one of them varies it in the casing Graph actually sends.
 */
function sku(overrides: Partial<SubscribedSku> = {}): SubscribedSku {
  return {
    skuId: "0f7b1a2c-0000-0000-0000-000000000001",
    skuPartNumber: "VIRTUAL_AGENT_USL",
    appliesTo: "User",
    capabilityStatus: "Enabled",
    consumedUnits: 8,
    prepaidUnits: { enabled: 10, suspended: 0, warning: 0 },
    ...overrides,
  };
}

/** The one event a single pool produces, with its facts already unpacked. */
function factsFor(one: SubscribedSku) {
  const [event] = microsoftSeatEvents({ skus: [one], day: DAY });
  return {
    event,
    extra: (event?.extra ?? {}) as Record<string, string>,
  };
}

describe("reading a tenant's licence list", () => {
  describe("when the reply is the list a tenant actually holds", () => {
    /** @scenario "Each licence pool is recorded with bought and assigned counts" */
    it("reads every pool the tenant holds, whatever kind each one is", () => {
      const read = readSubscribedSkuRows({
        response: {
          value: [
            sku(),
            sku({ skuPartNumber: "FLOW_FREE" }),
            sku({ skuPartNumber: "MCOMEETADV", appliesTo: "Company" }),
          ],
        },
      });

      expect(read.skus).toHaveLength(3);
      expect(read.unreadableRows).toBe(0);
      expect(read.malformed).toBe(false);
    });

    /** @scenario "Each licence pool is recorded with bought and assigned counts" */
    it("drops the fields Graph sends that nothing here reads", () => {
      const read = readSubscribedSkuRows({
        response: {
          value: [
            {
              ...sku(),
              accountId: "aaaaaaaa-0000-0000-0000-000000000000",
              prepaidUnits: { enabled: 10, suspended: 0, warning: 0 },
              servicePlans: [{ servicePlanId: "x", provisioningStatus: "y" }],
            },
          ],
        },
      });

      expect(read.skus[0]).toEqual(sku());
    });

    /** @scenario "Each licence pool is recorded with bought and assigned counts" */
    it("counts a row it cannot read and keeps the rows it can", () => {
      const read = readSubscribedSkuRows({
        response: {
          value: [
            sku(),
            { skuPartNumber: "VIRTUAL_AGENT_USL" },
            { ...sku(), consumedUnits: "eight" },
          ],
        },
      });

      // One unreadable pool must not cost the tenant the rest of its list,
      // and it must not read as a pool that does not exist either.
      expect(read.skus).toHaveLength(1);
      expect(read.unreadableRows).toBe(2);
      expect(read.malformed).toBe(false);
    });
  });

  describe("when the reply is not the shape this reads at all", () => {
    /** @scenario "A failed licence read holds the day rather than recording zero" */
    it("says so, rather than reading as a tenant that holds no licences", () => {
      const read = readSubscribedSkuRows({
        response: { error: { code: "Authorization_RequestDenied" } },
      });

      // An HTTP 200 carrying an error body. Reported as malformed, because
      // an empty list alone would let the caller report the day as read and
      // publish a tenant with no seats at all.
      expect(read.malformed).toBe(true);
      expect(read.skus).toEqual([]);
    });

    /** @scenario "A failed licence read holds the day rather than recording zero" */
    it("does not confuse a tenant that holds nothing with a reply nobody could read", () => {
      const read = readSubscribedSkuRows({ response: { value: [] } });

      expect(read.malformed).toBe(false);
      expect(read.skus).toEqual([]);
    });
  });
});

describe("the events one licence read produces", () => {
  describe("when the tenant holds a paid per-person pool", () => {
    /** @scenario "Each licence pool is recorded with bought and assigned counts" */
    it("records how many seats are bought and how many are assigned", () => {
      const { extra } = factsFor(sku());

      // Bought minus assigned is the money conversation. Neither number
      // alone can say that two paid seats are sitting empty.
      expect(extra.seatsBought).toBe("10");
      expect(extra.seatsAssigned).toBe("8");
    });

    /** @scenario "Each licence pool is recorded with bought and assigned counts" */
    it("carries the pool's own name and no person, because a pool names none", () => {
      const { event, extra } = factsFor(sku());

      expect(event?.action).toBe(SEAT_REPORT_ACTION);
      expect(event?.target).toBe("VIRTUAL_AGENT_USL");
      expect(event?.actor).toBe("");
      expect(extra.skuPartNumber).toBe("VIRTUAL_AGENT_USL");
    });

    /** @scenario "Each licence pool is recorded with bought and assigned counts" */
    it("reports no money, because a licence list is not a bill", () => {
      const { event } = factsFor(sku());

      // What the seats cost is on the invoice, not here. A figure invented
      // from a unit count would be added to the bill the cost read already
      // recorded, and the customer would be shown their spend twice.
      expect(event?.cost_usd).toBe("0");
      expect(event?.tokens_input).toBe(0);
      expect(event?.tokens_output).toBe(0);
    });

    /** @scenario "Each licence pool is recorded with bought and assigned counts" */
    it("dates the event to the day reported on, not to the moment it was read", () => {
      const { event } = factsFor(sku());

      expect(event?.event_timestamp).toBe("2026-08-30T00:00:00.000Z");
    });
  });

  describe("when the same pool is read twice on the same day", () => {
    /** @scenario "Both reads of a re-read day describe the same pool under the same identity" */
    it("gives both reads the same identity, so the later one lands over the first", () => {
      const first = microsoftSeatEvents({
        skus: [sku({ consumedUnits: 8 })],
        day: DAY,
      });
      const second = microsoftSeatEvents({
        skus: [sku({ consumedUnits: 9 })],
        day: DAY,
      });

      expect(second[0]?.source_event_id).toBe(first[0]?.source_event_id);
      // The identity is the pool and the day and nothing else. Were a count
      // part of it, a corrected count would mint a fresh key and be added
      // beside the count it was meant to replace.
      expect(first[0]?.source_event_id).toBe(
        `msgraph_seats:${sku().skuId}:${DAY}`,
      );
    });

    /** @scenario "Both reads of a re-read day describe the same pool under the same identity" */
    it("keeps two pools, and two days, apart", () => {
      const [agent, flow] = microsoftSeatEvents({
        skus: [sku(), sku({ skuId: "0f7b1a2c-0000-0000-0000-000000000002" })],
        day: DAY,
      });
      const [nextDay] = microsoftSeatEvents({
        skus: [sku()],
        day: "2026-08-31",
      });

      expect(agent?.source_event_id).not.toBe(flow?.source_event_id);
      expect(agent?.source_event_id).not.toBe(nextDay?.source_event_id);
    });
  });

  describe("when the pool applies to the company rather than to a person", () => {
    /** @scenario "A pool covering the whole company is not counted as seats" */
    it("records it, marked as not per-person", () => {
      const { event, extra } = factsFor(
        sku({
          skuPartNumber: "MCOMEETADV",
          appliesTo: "Company",
          consumedUnits: 0,
          prepaidUnits: { enabled: 25, suspended: 0, warning: 0 },
        }),
      );

      // A company pool reports zero assigned forever, so counting its units
      // as seats is the loudest possible false finding: "25 unused licences"
      // for a pool that has no seats to leave unused.
      expect(extra.perPerson).toBe("false");
      expect(event).toBeDefined();
      expect(extra.seatsBought).toBe("25");
    });
  });

  describe("when the pool is free, a trial or a developer plan", () => {
    /** @scenario "A free or trial pool is not counted as paid seats" */
    it("records it, marked as free", () => {
      const { extra } = factsFor(
        sku({
          skuPartNumber: "FLOW_FREE",
          consumedUnits: 3,
          prepaidUnits: { enabled: 10000, suspended: 0, warning: 0 },
        }),
      );

      // The 10,000 is a ceiling on how far the licence may spread, not a
      // quantity anyone bought. Counted as purchased it buries the handful
      // of paid seats that really are going unused.
      expect(extra.free).toBe("true");
      expect(extra.seatStem).toBe("true");
      expect(extra.perPerson).toBe("true");
    });

    /** @scenario "A free or trial pool is not counted as paid seats" */
    it("does not mark a paid pool free just because it is a seat", () => {
      const { extra } = factsFor(sku());

      expect(extra.free).toBe("false");
      expect(extra.seatStem).toBe("true");
    });
  });

  describe("when the provider has suspended the pool", () => {
    /** @scenario "A suspended pool is not counted as live seats" */
    it("records it, marked as not live", () => {
      const { event, extra } = factsFor(sku({ capabilityStatus: "Suspended" }));

      expect(extra.live).toBe("false");
      expect(event).toBeDefined();
    });
  });

  describe("when the pool has lapsed but is still in its grace period", () => {
    /** @scenario "A pool in its grace period still counts as live seats" */
    it("counts it as live", () => {
      const { extra } = factsFor(sku({ capabilityStatus: "Warning" }));

      // The provider's own portal still honours these seats. A customer a
      // week late on a renewal has not stopped paying for people to sit in
      // them, and dropping the pool erases real spend exactly then.
      expect(extra.live).toBe("true");
    });
  });

  describe("when a live pool has some of its units suspended", () => {
    /** @scenario "Suspended units inside a live pool are not counted as bought" */
    it("leaves the suspended units out of the bought count", () => {
      const { extra } = factsFor(
        sku({ prepaidUnits: { enabled: 10, suspended: 5, warning: 0 } }),
      );

      // Suspension is per unit, not only per pool: the frozen slice is not
      // being paid for this month.
      expect(extra.seatsBought).toBe("10");
    });

    /** @scenario "Suspended units inside a live pool are not counted as bought" */
    it("counts the units still inside their grace period as bought", () => {
      const { extra } = factsFor(
        sku({
          capabilityStatus: "Warning",
          prepaidUnits: { enabled: 8, suspended: 5, warning: 2 },
        }),
      );

      expect(extra.seatsBought).toBe("10");
    });
  });
});

describe("whether a run asks about licences at all", () => {
  describe("when a kept position already reported today", () => {
    /** @scenario "A day already reported is not asked about again" */
    it("does not ask again the same day", () => {
      expect(
        seatsReadIsDue({ nowMs: NOW_MS, reportedThroughDay: "2026-08-30" }),
      ).toBe(false);
    });
  });

  describe("when the last report was before today", () => {
    /** @scenario "A day already reported is not asked about again" */
    it("asks again once the day has rolled", () => {
      expect(
        seatsReadIsDue({ nowMs: NOW_MS, reportedThroughDay: "2026-08-29" }),
      ).toBe(true);
    });

    /** @scenario "A day already reported is not asked about again" */
    it("asks when nothing has ever been reported", () => {
      // A run whose position was thrown away has reported nothing, so the
      // next run asks again — that re-read is what the stable identity above
      // makes safe.
      expect(seatsReadIsDue({ nowMs: NOW_MS, reportedThroughDay: null })).toBe(
        true,
      );
    });
  });

  describe("the day a read reports on", () => {
    /** @scenario "A day already reported is not asked about again" */
    it("is the same day the watermark and the event identity are measured in", () => {
      // One definition of "today" for all three, or a run could report a day
      // it did not date its events to and re-ask about a day it just wrote.
      const day = seatsReportDay({ nowMs: NOW_MS });

      expect(day).toBe("2026-08-30");
      expect(
        nextSeatsCursor({
          nowMs: NOW_MS,
          previous: { reportedThroughDay: null, heldSinceMs: null },
          outcome: "reported",
        }).reportedThroughDay,
      ).toBe(day);
      expect(
        microsoftSeatEvents({ skus: [sku()], day })[0]?.event_timestamp,
      ).toBe(`${day}T00:00:00.000Z`);
    });

    /** @scenario "A day already reported is not asked about again" */
    it("reads the UTC day, not the day where the worker happens to run", () => {
      // Late evening in the Americas is already tomorrow in UTC. A local day
      // here would report one day and stamp watermarks in another.
      expect(
        seatsReportDay({ nowMs: Date.parse("2026-08-30T23:30:00Z") }),
      ).toBe("2026-08-30");
      expect(
        seatsReportDay({ nowMs: Date.parse("2026-08-31T00:30:00Z") }),
      ).toBe("2026-08-31");
    });
  });
});

describe("what the next run asks for", () => {
  describe("when this run reported the day's licences", () => {
    /** @scenario "A day already reported is not asked about again" */
    it("records the day as reported and clears any hold", () => {
      const next = nextSeatsCursor({
        nowMs: NOW_MS,
        previous: {
          reportedThroughDay: "2026-08-29",
          heldSinceMs: NOW_MS - 1000,
        },
        outcome: "reported",
      });

      expect(next).toEqual({
        reportedThroughDay: "2026-08-30",
        heldSinceMs: null,
      });
    });
  });

  describe("when the licence read was refused", () => {
    /** @scenario "A failed licence read holds the day rather than recording zero" */
    it("reports nothing for the day and leaves the next run asking again", () => {
      const next = nextSeatsCursor({
        nowMs: NOW_MS,
        previous: { reportedThroughDay: "2026-08-29", heldSinceMs: null },
        outcome: "held",
      });

      expect(next.reportedThroughDay).toBe("2026-08-29");
      expect(next.heldSinceMs).toBe(NOW_MS);
      expect(
        seatsReadIsDue({
          nowMs: NOW_MS,
          reportedThroughDay: next.reportedThroughDay,
        }),
      ).toBe(true);
    });

    /** @scenario "A failed licence read holds the day rather than recording zero" */
    it("leaves nothing reported when it has never read licences before", () => {
      const next = nextSeatsCursor({
        nowMs: NOW_MS,
        previous: { reportedThroughDay: null, heldSinceMs: null },
        outcome: "held",
      });

      expect(next.reportedThroughDay).toBe(null);
      expect(next.heldSinceMs).toBe(NOW_MS);
    });

    /** @scenario "A failed licence read holds the day rather than recording zero" */
    it("keeps the original hold instant across repeated failures", () => {
      const startedAt = NOW_MS - 60_000;
      const next = nextSeatsCursor({
        nowMs: NOW_MS,
        previous: {
          reportedThroughDay: "2026-08-29",
          heldSinceMs: startedAt,
        },
        outcome: "held",
      });

      // Refreshing it on every failure would put the cap out of reach, so a
      // consent that was never granted would hold the source forever.
      expect(next.heldSinceMs).toBe(startedAt);
    });
  });

  describe("when the day has been held past the cap", () => {
    /** @scenario "A day held for too long is given up rather than held forever" */
    it("stops holding the day and moves on", () => {
      const heldSinceMs = NOW_MS - SEATS_MAX_HOLD_MS - 1;
      const next = nextSeatsCursor({
        nowMs: NOW_MS,
        previous: { reportedThroughDay: "2026-07-01", heldSinceMs },
        outcome: "held",
      });

      // Marking today reported is what stops the asking: every later run
      // today finds nothing due and makes no request at all.
      expect(next.reportedThroughDay).toBe("2026-08-30");
      expect(
        seatsReadIsDue({
          nowMs: NOW_MS,
          reportedThroughDay: next.reportedThroughDay,
        }),
      ).toBe(false);
    });

    /** @scenario "A day held for too long is given up rather than held forever" */
    it("stays given up, so a consent never granted costs one request a day", () => {
      const heldSinceMs = NOW_MS - SEATS_MAX_HOLD_MS - 1;
      const givenUp = nextSeatsCursor({
        nowMs: NOW_MS,
        previous: { reportedThroughDay: "2026-07-01", heldSinceMs },
        outcome: "held",
      });

      // The hold instant is KEPT rather than cleared. Clearing it would open
      // a fresh week in which every run asks again, which is the cost the
      // cap exists to stop; keeping it means tomorrow's one retry gives up
      // again immediately and the tenant is asked once a day, forever.
      expect(givenUp.heldSinceMs).toBe(heldSinceMs);

      const tomorrow = NOW_MS + 24 * 60 * 60 * 1000;
      expect(
        seatsReadIsDue({
          nowMs: tomorrow,
          reportedThroughDay: givenUp.reportedThroughDay,
        }),
      ).toBe(true);
      expect(
        nextSeatsCursor({
          nowMs: tomorrow,
          previous: givenUp,
          outcome: "held",
        }).reportedThroughDay,
      ).toBe("2026-08-31");
    });

    /** @scenario "A day held for too long is given up rather than held forever" */
    it("takes a granted consent back out of the hold as soon as one read lands", () => {
      const givenUp = {
        reportedThroughDay: "2026-08-30",
        heldSinceMs: NOW_MS - SEATS_MAX_HOLD_MS - 1,
      };

      expect(
        nextSeatsCursor({
          nowMs: NOW_MS + 24 * 60 * 60 * 1000,
          previous: givenUp,
          outcome: "reported",
        }).heldSinceMs,
      ).toBe(null);
    });
  });
});
