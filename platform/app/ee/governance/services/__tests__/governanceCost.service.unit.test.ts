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

type LaneRow = Awaited<
  ReturnType<GovernanceCostRollupClickHouseRepository["sumDaysByLane"]>
>[number];

/** A prisma double that answers the governance-project lookup and nothing else. */
function prismaWithGovProject(id: string | null) {
  return {
    project: { findFirst: vi.fn().mockResolvedValue(id ? { id } : null) },
  } as unknown as Parameters<typeof GovernanceCostService.create>[0]["prisma"];
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
        const service = GovernanceCostService.create({
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
        const service = GovernanceCostService.create({
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
        const service = GovernanceCostService.create({
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
        const service = GovernanceCostService.create({
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
        const service = GovernanceCostService.create({
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
        const service = GovernanceCostService.create({
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
});
