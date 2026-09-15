// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * The cost summary for an organization with no hidden governance project.
 *
 * That project is minted by `ensureHiddenGovernanceProject` the first time an
 * IngestionSource is created, and by nothing else — so an organization whose
 * gateway serves real traffic, and which has never connected a provider bill,
 * has none. `summary()` returned the empty summary for every one of them, and
 * with it `unavailableReason: "no_governance_project"`, which is the screen's
 * word for "nothing has been recorded at all".
 *
 * Two answers were never that project's to give. The metered lane reads the
 * gateway's own per-request ledger, keyed by the traffic's PROJECT tenant and
 * scoped to every project of the organization. And the adoption headcount
 * rides the same DTO: the card cannot state its own absence, so it is gated on
 * whether this summary holds figures, and a summary that says "unavailable"
 * holds none.
 *
 * WHY THE MONEY IS ASSERTED TOO. The billed lane, the provider bars, the
 * per-currency lines and the seat lane are keyed by the governance tenant.
 * There is no such tenant here, so they must stay empty and their reads must
 * not be issued at all. The rollup doubles below THROW on any call and that
 * throw propagates, so a fix that answered the billed lane from a wider scope
 * fails here rather than shipping a spend figure as a side effect of a
 * headcount fix (ADR-128 ruling 6, and the same discipline as
 * `activity-monitor/__tests__/activityMonitorAdoptionWithoutGovProject.unit.test.ts`).
 *
 * The seat double throws too, but its throw polices nothing: `readSeats`
 * catches whatever the licence read raises and answers `read_failed`, on the
 * deliberate rule that a broken seat read must not take the cost lanes down
 * with it. A widened seat read would therefore be swallowed and never reach
 * the test as an error. What catches that one instead is the `calls` ledger
 * every double appends to before it throws, together with the seat lane still
 * reporting `awaiting_data` rather than a failure — both asserted in "issues
 * no read keyed by the governance tenant and holds no billed figure", and
 * nowhere else in this file. Keep them there.
 *
 * Spec: specs/governance/governance-cost-screen.feature — the rules under
 * "THE HIDDEN GOVERNANCE PROJECT SCOPES THE BILL, NOT THE ORGANIZATION".
 */
import { describe, expect, it, vi } from "vitest";

import { summaryAsRead } from "~/components/governance/costs/costSampleMode";
import type { ProjectRepository } from "~/server/app-layer/projects/repositories/project.repository";
import { GovernanceCostService } from "../governanceCost.service";
import type { GovernanceCostRollupClickHouseRepository } from "../governanceCostRollup.clickhouse.repository";
import type {
  GovernanceGatewaySpendClickHouseRepository,
  GovernanceGatewaySpendDayRow,
} from "../governanceGatewaySpend.clickhouse.repository";
import type { GovernanceOcsfEventsClickHouseRepository } from "../governanceOcsfEvents.clickhouse.repository";

const NANO = 1_000_000_000;

const ORGANIZATION_PROJECTS = ["proj-assistants", "proj-support-desk"];

/** Prisma for an organization with projects, no governance one, no sources. */
const prisma = {
  project: { findFirst: vi.fn().mockResolvedValue(null) },
  ingestionSource: { findMany: vi.fn().mockResolvedValue([]) },
} as unknown as Parameters<typeof GovernanceCostService.create>[0]["prisma"];

/**
 * The rollup, refusing every read.
 *
 * Not `undefined` — that is the no-cost-store case and a different answer.
 * This deployment HAS a cost store; what it has no tenant for is the bill.
 */
function rollupThatMustNotBeRead(): {
  repository: GovernanceCostRollupClickHouseRepository;
  calls: string[];
} {
  const calls: string[] = [];
  const refuse = (name: string) => async () => {
    calls.push(name);
    throw new Error(`${name} issued with no governance tenant to scope it to`);
  };
  return {
    calls,
    repository: {
      sumDaysByLane: refuse("sumDaysByLane"),
      sumWindowByProvider: refuse("sumWindowByProvider"),
      sumWindowByCurrency: refuse("sumWindowByCurrency"),
      sumWindowBySpender: refuse("sumWindowBySpender"),
      hasRowsForSource: refuse("hasRowsForSource"),
    } as unknown as GovernanceCostRollupClickHouseRepository,
  };
}

function seatReadThatMustNotBeRead(calls: string[]) {
  return {
    findLatestSeatReports: async () => {
      calls.push("findLatestSeatReports");
      throw new Error("seat read issued with no governance tenant");
    },
  } as unknown as GovernanceOcsfEventsClickHouseRepository;
}

function gatewayDay(
  overrides: Partial<GovernanceGatewaySpendDayRow> = {},
): GovernanceGatewaySpendDayRow {
  return {
    day: "2026-08-01",
    amountNanoUsd: 0,
    requestCount: 0,
    pricedRequestCount: 0,
    requestsWithoutAmount: 0,
    tokensTotal: 0,
    ...overrides,
  };
}

function serviceFor(days: GovernanceGatewaySpendDayRow[]) {
  const { repository, calls } = rollupThatMustNotBeRead();
  const readDays = vi.fn().mockResolvedValue(days);
  const service = GovernanceCostService.create({
    prisma,
    costRollup: repository,
    ocsfEvents: seatReadThatMustNotBeRead(calls),
    gatewaySpend: {
      sumDaysForOrganizationProjects: readDays,
    } as unknown as GovernanceGatewaySpendClickHouseRepository,
    projects: {
      findAllIdsByOrganization: vi
        .fn()
        .mockResolvedValue(ORGANIZATION_PROJECTS),
    } as unknown as ProjectRepository,
  });
  return { service, calls, readDays };
}

describe("GovernanceCostService.summary", () => {
  describe("given an organization with gateway traffic and no governance project", () => {
    /** @scenario "The metered lane answers for an organization that has connected no provider bill" */
    it("reports what the gateway metered across the organization's projects", async () => {
      const { service, readDays } = serviceFor([
        gatewayDay({
          amountNanoUsd: 12 * NANO,
          requestCount: 3,
          pricedRequestCount: 3,
          tokensTotal: 900,
        }),
      ]);

      const result = await service.summary({
        organizationId: "org-1",
        windowDays: 7,
        now: new Date("2026-08-07T12:00:00Z"),
      });

      expect(result.gateway.amountUsd).toBe(12);
      // The ledger is scoped to the organization's own projects, which is the
      // whole reason this lane can answer without a governance tenant.
      expect(readDays).toHaveBeenCalledWith({
        tenantIds: ORGANIZATION_PROJECTS,
        fromDay: "2026-08-01",
        toDay: "2026-08-07",
      });
      // Not "unavailable": a lane answered. The screen's own connectedness
      // test is asserted rather than the flag alone, because that test is what
      // decides both whether the lanes draw and whether the adoption headcount
      // is allowed to print — and the two must never disagree.
      expect(result.unavailableReason).toBeNull();
      expect(summaryAsRead(result)?.length).toBeGreaterThan(0);
    });

    /** @scenario "No read scoped to the hidden governance project is issued without one" */
    it("issues no read keyed by the governance tenant and holds no billed figure", async () => {
      const { service, calls } = serviceFor([
        gatewayDay({
          amountNanoUsd: 12 * NANO,
          requestCount: 3,
          pricedRequestCount: 3,
        }),
      ]);

      const result = await service.summary({
        organizationId: "org-1",
        windowDays: 7,
        now: new Date("2026-08-07T12:00:00Z"),
      });

      expect(calls).toEqual([]);
      // The DTO must not say "unavailable" while the metered lane holds a
      // figure: that word is what the screen draws its "nothing was recorded"
      // banner from, and a banner over a stated total is the one arrangement
      // this whole screen refuses.
      expect(result.unavailableReason).toBeNull();
      expect(result.billed.amountUsd).toBeNull();
      expect(result.billed.currencyTotals).toEqual([]);
      expect(result.providers).toEqual([]);
      expect(result.azureBilling).toBeNull();
      // Awaiting, not failed: no licence list was read because there is no
      // tenant to read one under, which is not the same as a read breaking.
      expect(result.seats).toEqual({ status: "awaiting_data" });
      // A billed day would have to come from a read that was never issued.
      expect(result.series.every((day) => day.billedUsd === null)).toBe(true);
    });
  });

  describe("given an organization with neither a governance project nor gateway traffic", () => {
    // Mostly unchanged by the fix: both codepaths end in a screen that says
    // nothing was recorded. It is here as the guard on the half of the change
    // that must NOT move — widening the gate must not turn an empty
    // organization into a stated zero.
    /** @scenario "An organization with neither a governance project nor gateway traffic reports nothing" */
    it("reports no lane at all, which the screen reads as nothing recorded", async () => {
      const { service } = serviceFor([]);

      const result = await service.summary({
        organizationId: "org-1",
        windowDays: 7,
        now: new Date("2026-08-07T12:00:00Z"),
      });

      expect(result.billed.amountUsd).toBeNull();
      expect(result.gateway.amountUsd).toBeNull();
      expect(result.gateway.requestsWithoutAmount).toBe(0);
      expect(result.seats).toEqual({ status: "awaiting_data" });
      expect(result.series).toEqual([]);
      // An organization with nothing in it still reports NO reason, and that
      // is the rule this change establishes: the summary never says
      // `no_governance_project`, which now survives only on the four
      // breakdowns, the ones that read the rollup and nothing else. The
      // screen's "nothing was recorded" sentence is drawn from the lane count
      // being zero, not from the reason flag, so the empty organization and
      // the gated one have to converge on the same DTO rather than on the same
      // rendering reached by two different routes.
      //
      // It is also the only assertion here that can tell those two apart.
      // `summaryAsRead` reports zero lanes for ANY non-null reason, so the
      // line below holds just as well under the early return this replaced.
      expect(result.unavailableReason).toBeNull();
      expect(summaryAsRead(result)?.length).toBe(0);
    });
  });
});
