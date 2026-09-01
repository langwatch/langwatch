// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * The cost service's absence semantics.
 *
 * The whole point of this service is that it never invents a zero, so these
 * tests are mostly about what it does when it has nothing. The screen test
 * covers the rendered side; this covers the DTO, because a zero introduced
 * here would reach every future consumer of the read, not just the one screen
 * that exists today.
 *
 * Spec: specs/governance/governance-cost-screen.feature
 */
import { describe, expect, it, vi } from "vitest";
import { GovernanceCostService } from "../governanceCost.service";
import type { GovernanceCostRollupClickHouseRepository } from "../governanceCostRollup.clickhouse.repository";
import type { GovernanceOcsfEventsClickHouseRepository } from "../governanceOcsfEvents.clickhouse.repository";

type LaneRow = Awaited<
  ReturnType<GovernanceCostRollupClickHouseRepository["sumDaysByLane"]>
>[number];

/** One ingestion source, as the stale-source read selects it. */
type SourceRow = {
  name: string;
  status: string;
  errorCount: number;
  lastSuccessAt: Date | null;
};

/**
 * A prisma double that answers the governance-project lookup and the source
 * read behind the stale-data notice. `sources` defaults to none, which is the
 * healthy answer: no source has stopped, so there is nothing to caveat.
 */
function prismaWithGovProject(id: string | null, sources: SourceRow[] = []) {
  return {
    project: { findFirst: vi.fn().mockResolvedValue(id ? { id } : null) },
    ingestionSource: { findMany: vi.fn().mockResolvedValue(sources) },
  } as unknown as Parameters<typeof GovernanceCostService.create>[0]["prisma"];
}

type SeatRow = Awaited<
  ReturnType<GovernanceOcsfEventsClickHouseRepository["findLatestSeatReports"]>
>[number];

/** A seat pool the licence list would count: live, paid, held by a person. */
function seatPool(overrides: Partial<SeatRow> = {}): SeatRow {
  return {
    sourceId: "is-1",
    skuPartNumber: "AGENT_SEAT_USL",
    day: "2026-08-01",
    seatsBought: 4,
    seatsAssigned: 2,
    perPerson: true,
    live: true,
    free: false,
    seatStem: true,
    ...overrides,
  };
}

function ocsfReturning(rows: SeatRow[]) {
  return {
    findLatestSeatReports: vi.fn().mockResolvedValue(rows),
  } as unknown as GovernanceOcsfEventsClickHouseRepository;
}

/** The service with the seat read absent unless a test supplies one. */
function createService(deps: {
  prisma: Parameters<typeof GovernanceCostService.create>[0]["prisma"];
  costRollup: GovernanceCostRollupClickHouseRepository | undefined;
  ocsfEvents?: GovernanceOcsfEventsClickHouseRepository | undefined;
}) {
  return GovernanceCostService.create({ ocsfEvents: undefined, ...deps });
}

function rollupReturning(rows: LaneRow[]) {
  return {
    sumDaysByLane: vi.fn().mockResolvedValue(rows),
  } as unknown as GovernanceCostRollupClickHouseRepository;
}

const NANO = 1_000_000_000;

describe("GovernanceCostService.summary", () => {
  describe("given a deployment with no cost store", () => {
    describe("when requesting the summary", () => {
      it("reports unavailable with null amounts rather than zeros", async () => {
        const service = createService({
          prisma: prismaWithGovProject("gov-1"),
          costRollup: undefined,
        });

        const result = await service.summary({
          organizationId: "org-1",
          windowDays: 30,
        });

        expect(result.unavailableReason).toBe("no_cost_store");
        // The house degrade pattern would return zeros here. A zero is a claim
        // that nothing was spent, which on a deployment that never recorded
        // cost is a statement we have no basis for.
        expect(result.billed.amountUsd).toBeNull();
        expect(result.gateway.amountUsd).toBeNull();
        expect(result.billed.amountUsd).not.toBe(0);
        expect(result.gateway.amountUsd).not.toBe(0);
        expect(result.series).toEqual([]);
      });
    });
  });

  describe("given an organization that has never ingested anything", () => {
    describe("when requesting the summary", () => {
      it("reports unavailable with null amounts rather than zeros", async () => {
        const service = createService({
          prisma: prismaWithGovProject(null),
          costRollup: rollupReturning([]),
        });

        const result = await service.summary({
          organizationId: "org-1",
          windowDays: 30,
        });

        expect(result.unavailableReason).toBe("no_governance_project");
        expect(result.billed.amountUsd).toBeNull();
        expect(result.gateway.amountUsd).toBeNull();
      });
    });
  });

  describe("given both lanes reporting different totals", () => {
    describe("when requesting the summary", () => {
      it("keeps each lane's figure in its own lane", async () => {
        const rollup = rollupReturning([
          {
            day: "2026-08-01",
            costSource: "pulled",
            amountNanoUsd: 12 * NANO,
            cellsWithoutAmount: 0,
          },
          {
            day: "2026-08-01",
            costSource: "gateway",
            amountNanoUsd: 7 * NANO,
            cellsWithoutAmount: 0,
          },
        ]);
        const service = createService({
          prisma: prismaWithGovProject("gov-1"),
          costRollup: rollup,
        });

        const result = await service.summary({
          organizationId: "org-1",
          windowDays: 30,
          now: new Date("2026-08-01T12:00:00.000Z"),
        });

        // `pulled` is the provider's own reporting — the billed lane. A swap
        // here is the defect the distinct fixtures exist to expose.
        expect(result.billed.amountUsd).toBe(12);
        expect(result.gateway.amountUsd).toBe(7);
        expect(result.series).toEqual([
          { day: "2026-08-01", billedUsd: 12, gatewayUsd: 7 },
        ]);
      });
    });

    describe("when requesting a seven-day summary", () => {
      it("reads the window ending today, inclusive of both ends", async () => {
        const rollup = rollupReturning([]);
        const service = createService({
          prisma: prismaWithGovProject("gov-1"),
          costRollup: rollup,
        });

        await service.summary({
          organizationId: "org-1",
          windowDays: 7,
          now: new Date("2026-08-10T00:00:00.000Z"),
        });

        expect(rollup.sumDaysByLane).toHaveBeenCalledWith({
          tenantId: "gov-1",
          fromDay: "2026-08-04",
          toDay: "2026-08-10",
        });
      });
    });
  });

  describe("given a lane whose rows carry no stated amount", () => {
    describe("when requesting the summary", () => {
      it("reports null for that lane and counts the unpriced cells", async () => {
        const service = createService({
          prisma: prismaWithGovProject("gov-1"),
          costRollup: rollupReturning([
            {
              day: "2026-08-01",
              costSource: "pulled",
              amountNanoUsd: null,
              cellsWithoutAmount: 3,
            },
          ]),
        });

        const result = await service.summary({
          organizationId: "org-1",
          windowDays: 30,
          now: new Date("2026-08-01T12:00:00.000Z"),
        });

        expect(result.unavailableReason).toBeNull();
        expect(result.billed.amountUsd).toBeNull();
        expect(result.billed.cellsWithoutAmount).toBe(3);
        // The other lane simply has no rows — also null, never 0.
        expect(result.gateway.amountUsd).toBeNull();
      });
    });
  });

  describe("given a refund-heavy billed day", () => {
    describe("when requesting the summary", () => {
      it("passes the negative total through without interpretation", async () => {
        const service = createService({
          prisma: prismaWithGovProject("gov-1"),
          costRollup: rollupReturning([
            {
              day: "2026-08-01",
              costSource: "pulled",
              amountNanoUsd: -42.5 * NANO,
              cellsWithoutAmount: 0,
            },
          ]),
        });

        const result = await service.summary({
          organizationId: "org-1",
          windowDays: 30,
          now: new Date("2026-08-01T12:00:00.000Z"),
        });

        expect(result.billed.amountUsd).toBe(-42.5);
      });
    });
  });
  describe("given the tenant's licence list has been read", () => {
    describe("when requesting the summary", () => {
      it("reports each pool's bought and assigned counts and no money", async () => {
        const service = createService({
          prisma: prismaWithGovProject("gov-1"),
          costRollup: rollupReturning([]),
          ocsfEvents: ocsfReturning([
            seatPool({ skuPartNumber: "AGENT_SEAT_USL" }),
            seatPool({
              skuPartNumber: "AGENT_SEAT_TRIAL_USL",
              seatsBought: 9,
              seatsAssigned: 1,
            }),
          ]),
        });

        const result = await service.summary({
          organizationId: "org-1",
          windowDays: 30,
          now: new Date("2026-08-01T12:00:00.000Z"),
        });

        expect(result.seats).toEqual({
          status: "reported",
          pools: [
            {
              skuPartNumber: "AGENT_SEAT_TRIAL_USL",
              day: "2026-08-01",
              seatsBought: 9,
              seatsAssigned: 1,
            },
            {
              skuPartNumber: "AGENT_SEAT_USL",
              day: "2026-08-01",
              seatsBought: 4,
              seatsAssigned: 2,
            },
          ],
        });
        // A seat event carries counts, never a price. A money field here would
        // be a figure nobody billed, added to the invoice that already holds
        // what the seats cost.
        for (const pool of result.seats.status === "reported"
          ? result.seats.pools
          : []) {
          expect(Object.keys(pool)).not.toContain("amountUsd");
        }
      });

      it("reads the licence list under the same tenant as the cost lanes", async () => {
        const ocsfEvents = ocsfReturning([seatPool()]);
        const service = createService({
          prisma: prismaWithGovProject("gov-1"),
          costRollup: rollupReturning([]),
          ocsfEvents,
        });

        await service.summary({ organizationId: "org-1", windowDays: 30 });

        expect(ocsfEvents.findLatestSeatReports).toHaveBeenCalledWith({
          tenantId: "gov-1",
        });
      });
    });
  });

  describe("given pools the licence list does not count as seats", () => {
    describe("when requesting the summary", () => {
      /** @scenario "Only pools somebody is paying to seat people in reach the screen" */
      it("leaves out the company-wide, free, dormant and non-seat pools", async () => {
        // The classification is the whole of the value here: a naive count on
        // a real tenant said 27 unused seats when the answer was 2, because a
        // company-wide pool and a free pool were counted as seats somebody
        // bought.
        const service = createService({
          prisma: prismaWithGovProject("gov-1"),
          costRollup: rollupReturning([]),
          ocsfEvents: ocsfReturning([
            seatPool({ skuPartNumber: "COUNTED_AGENT_USL" }),
            seatPool({ skuPartNumber: "COMPANY_WIDE", perPerson: false }),
            seatPool({ skuPartNumber: "FLOW_FREE", free: true }),
            seatPool({ skuPartNumber: "SUSPENDED_USL", live: false }),
            seatPool({ skuPartNumber: "MAILBOX_USL", seatStem: false }),
          ]),
        });

        const result = await service.summary({
          organizationId: "org-1",
          windowDays: 30,
        });

        expect(
          result.seats.status === "reported"
            ? result.seats.pools.map((pool) => pool.skuPartNumber)
            : [],
        ).toEqual(["COUNTED_AGENT_USL"]);
      });

      /** @scenario "A licence list with nothing countable in it reads as awaiting" */
      it("stays awaiting when no pool survives the count", async () => {
        const service = createService({
          prisma: prismaWithGovProject("gov-1"),
          costRollup: rollupReturning([]),
          ocsfEvents: ocsfReturning([
            seatPool({ skuPartNumber: "FLOW_FREE", free: true }),
          ]),
        });

        const result = await service.summary({
          organizationId: "org-1",
          windowDays: 30,
        });

        expect(result.seats).toEqual({ status: "awaiting_data" });
      });
    });
  });

  describe("given no licence list has been read", () => {
    describe("when requesting the summary", () => {
      it("says the seat lane is awaiting data", async () => {
        const service = createService({
          prisma: prismaWithGovProject("gov-1"),
          costRollup: rollupReturning([]),
          ocsfEvents: ocsfReturning([]),
        });

        const result = await service.summary({
          organizationId: "org-1",
          windowDays: 30,
        });

        expect(result.seats).toEqual({ status: "awaiting_data" });
      });
    });
  });

  describe("given the licence read fails while the cost lanes answer", () => {
    describe("when requesting the summary", () => {
      /** @scenario "A seat read that fails degrades only the seat lane" */
      it("says the seat read failed and still returns the cost lanes", async () => {
        const service = createService({
          prisma: prismaWithGovProject("gov-1"),
          costRollup: rollupReturning([
            {
              day: "2026-08-01",
              costSource: "pulled",
              amountNanoUsd: 12 * NANO,
              cellsWithoutAmount: 0,
            },
          ]),
          ocsfEvents: {
            findLatestSeatReports: vi
              .fn()
              .mockRejectedValue(new Error("seat read is down")),
          } as unknown as GovernanceOcsfEventsClickHouseRepository,
        });

        const result = await service.summary({
          organizationId: "org-1",
          windowDays: 30,
          now: new Date("2026-08-01T12:00:00.000Z"),
        });

        // Not `awaiting_data`: that would tell a customer their licences have
        // not been read when what happened is that we could not read them.
        expect(result.seats).toEqual({ status: "read_failed" });
        expect(result.unavailableReason).toBeNull();
        expect(result.billed.amountUsd).toBe(12);
      });

      /** @scenario "A seat read that fails degrades only the seat lane" */
      it("still fails the whole summary when the cost rollup is what failed", async () => {
        // Only the seat lane degrades. A money lane that swallowed its own
        // failure would render an absence as if it were a measurement.
        const service = createService({
          prisma: prismaWithGovProject("gov-1"),
          costRollup: {
            sumDaysByLane: vi
              .fn()
              .mockRejectedValue(new Error("cost rollup is down")),
          } as unknown as GovernanceCostRollupClickHouseRepository,
          ocsfEvents: ocsfReturning([seatPool()]),
        });

        await expect(
          service.summary({ organizationId: "org-1", windowDays: 30 }),
        ).rejects.toThrow("cost rollup is down");
      });
    });
  });

  describe("given a deployment with no event store to read licences from", () => {
    describe("when requesting the summary", () => {
      it("says the seat lane is awaiting data rather than reporting none", async () => {
        const service = createService({
          prisma: prismaWithGovProject("gov-1"),
          costRollup: rollupReturning([]),
          ocsfEvents: undefined,
        });

        const result = await service.summary({
          organizationId: "org-1",
          windowDays: 30,
        });

        expect(result.seats).toEqual({ status: "awaiting_data" });
      });
    });
  });

  // ADR-128 §4a. A source that has stopped pulling reports no spend, so the
  // lanes fall and the screen looks like a cheap month. These say where the
  // numbers stop being complete.
  describe("given a source has stopped pulling", () => {
    const brokenSince = (iso: string, name: string): SourceRow => ({
      name,
      status: "active",
      errorCount: 5,
      lastSuccessAt: new Date(iso),
    });

    describe("when requesting the summary", () => {
      it("names the source and the day its data stops", async () => {
        const service = createService({
          prisma: prismaWithGovProject("gov-1", [
            brokenSince("2026-08-20T09:00:00.000Z", "Azure Billing"),
          ]),
          costRollup: rollupReturning([]),
        });

        const result = await service.summary({
          organizationId: "org-1",
          windowDays: 30,
        });

        expect(result.staleSources).toEqual({
          oldestLastSuccessIso: "2026-08-20T09:00:00.000Z",
          sourceNames: ["Azure Billing"],
        });
      });

      /** @scenario "The gap is dated from the first source that started failing" */
      it("dates the gap from the first source that started failing, not the last", async () => {
        const service = createService({
          prisma: prismaWithGovProject("gov-1", [
            brokenSince("2026-08-25T09:00:00.000Z", "OpenAI Compliance"),
            brokenSince("2026-08-20T09:00:00.000Z", "Azure Billing"),
          ]),
          costRollup: rollupReturning([]),
        });

        const result = await service.summary({
          organizationId: "org-1",
          windowDays: 30,
        });

        // The totals stopped being whole when the earlier one broke.
        expect(result.staleSources?.oldestLastSuccessIso).toBe(
          "2026-08-20T09:00:00.000Z",
        );
        expect(result.staleSources?.sourceNames).toEqual([
          "Azure Billing",
          "OpenAI Compliance",
        ]);
      });
    });
  });

  describe("given every source is still pulling", () => {
    describe("when requesting the summary", () => {
      const healthy = {
        name: "Azure Billing",
        status: "active",
        errorCount: 0,
        lastSuccessAt: new Date("2026-09-01T09:00:00.000Z"),
      } as const;

      /** @scenario "A source nobody asked to run is not reported as having stopped" */
      it("ignores a source that was switched off while failing", async () => {
        const service = createService({
          prisma: prismaWithGovProject("gov-1", [
            healthy,
            // Switched off on purpose. A source nobody asked to run has not
            // stopped pulling, and a warning here would be a lie.
            {
              name: "Retired Source",
              status: "disabled",
              errorCount: 9,
              lastSuccessAt: new Date("2026-01-01T09:00:00.000Z"),
            },
          ]),
          costRollup: rollupReturning([]),
        });

        const result = await service.summary({
          organizationId: "org-1",
          windowDays: 30,
        });

        expect(result.staleSources).toBeNull();
      });

      /** @scenario "A source that has never pulled has no day to report" */
      it("ignores a failing source that has never once succeeded", async () => {
        const service = createService({
          prisma: prismaWithGovProject("gov-1", [
            healthy,
            // Failing hard, but there is no last success to date the gap from.
            {
              name: "Brand New",
              status: "active",
              errorCount: 5,
              lastSuccessAt: null,
            },
          ]),
          costRollup: rollupReturning([]),
        });

        const result = await service.summary({
          organizationId: "org-1",
          windowDays: 30,
        });

        expect(result.staleSources).toBeNull();
      });
    });
  });
});
