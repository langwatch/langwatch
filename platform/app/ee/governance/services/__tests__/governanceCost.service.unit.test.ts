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
import type { ProjectRepository } from "~/server/app-layer/projects/repositories/project.repository";
import { GovernanceCostService } from "../governanceCost.service";
import type { GovernanceCostRollupClickHouseRepository } from "../governanceCostRollup.clickhouse.repository";
import type { GovernanceGatewaySpendClickHouseRepository } from "../governanceGatewaySpend.clickhouse.repository";
import type { GovernanceOcsfEventsClickHouseRepository } from "../governanceOcsfEvents.clickhouse.repository";

type LaneRow = Awaited<
  ReturnType<GovernanceCostRollupClickHouseRepository["sumDaysByLane"]>
>[number];

type GatewayDayRow = Awaited<
  ReturnType<
    GovernanceGatewaySpendClickHouseRepository["sumDaysForOrganizationProjects"]
  >
>[number];

/**
 * One metered day, empty unless said otherwise. A test that wants the day to
 * hold a figure says how many of its requests were priced: the service reads
 * `pricedRequestCount`, not the money, to decide whether a figure stands.
 */
function gatewayDay(overrides: Partial<GatewayDayRow> = {}): GatewayDayRow {
  return {
    day: "2026-08-01",
    amountNanoUsd: 0,
    requestCount: 0,
    pricedRequestCount: 0,
    requestsWithoutAmount: 0,
    ...overrides,
  };
}

/**
 * The metered-lane ledger read, absent unless a test supplies days. Defaults
 * to no metered spend, which is the shape of every test that says nothing
 * about the gateway.
 */
function gatewayReturning(
  days: GatewayDayRow[] = [],
): GovernanceGatewaySpendClickHouseRepository {
  return {
    sumDaysForOrganizationProjects: vi.fn().mockResolvedValue(days),
    sumWindowByModel: vi.fn().mockResolvedValue([]),
    sumWindowByVirtualKey: vi.fn().mockResolvedValue([]),
  } as unknown as GovernanceGatewaySpendClickHouseRepository;
}

/**
 * One currency's window total for a lane, as the per-currency read answers it.
 *
 * Not yet implemented: `sumWindowByCurrency` on the rollup repository. It is
 * the read the per-currency lines are built from — the money in the currency
 * each cell was BILLED in, which the table has stored on every row since the
 * summary was built (`AmountNanoMinor`) and no aggregate read has ever asked
 * for.
 */
type CurrencyRow = Awaited<
  ReturnType<GovernanceCostRollupClickHouseRepository["sumWindowByCurrency"]>
>[number];

/** One ingestion source, as the stale-source read selects it. */
type SourceRow = {
  name: string;
  status: string;
  errorCount: number;
  lastSuccessAt: Date | null;
};

/** One ingestion source, as the Azure billing note's read selects it. */
type BillingSourceRow = {
  id?: string;
  parserConfig: Record<string, unknown> | null;
  pollerCursor: unknown;
};

/**
 * A prisma double answering the governance-project lookup and both source
 * reads behind the summary: the stale-data notice and the Azure billing note.
 *
 * The two reads select different columns, so the double answers each from the
 * rows that read can actually see. A test seeding a broken source cannot
 * conjure a billing note that way, nor the other way round -- which matters
 * because both readers happen to tolerate the other's rows silently, so
 * cross-talk would not fail, it would just quietly assert the wrong thing.
 * `sources` defaults to none: no source has stopped, and no bill is claimed.
 */
function prismaWithGovProject(
  id: string | null,
  sources: Array<SourceRow | BillingSourceRow> = [],
) {
  return {
    project: { findFirst: vi.fn().mockResolvedValue(id ? { id } : null) },
    ingestionSource: {
      findMany: vi.fn(
        async ({ select }: { select: Record<string, boolean> }) =>
          select.parserConfig
            ? sources.filter((source) => "parserConfig" in source)
            : sources.filter((source) => "name" in source),
      ),
    },
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

/**
 * The project repository, answering the organization's project ids — the
 * scope of the metered ledger read. Defaults to two projects, so a test that
 * says nothing about scope still exercises the multi-project fan-out. Only the
 * one method the service calls is stubbed.
 */
function projectsReturning(
  organizationProjectIds: string[] = ["proj-a", "proj-b"],
): ProjectRepository {
  return {
    findAllIdsByOrganization: vi.fn().mockResolvedValue(organizationProjectIds),
  } as unknown as ProjectRepository;
}

/**
 * The service with the seat read absent unless a test supplies one, and the
 * metered ledger defaulting to no spend. A test that only cares about the
 * billed lane gets an empty gateway read for free.
 */
function createService(deps: {
  prisma: Parameters<typeof GovernanceCostService.create>[0]["prisma"];
  costRollup: GovernanceCostRollupClickHouseRepository | undefined;
  ocsfEvents?: GovernanceOcsfEventsClickHouseRepository | undefined;
  gatewaySpend?: GovernanceGatewaySpendClickHouseRepository | undefined;
  projects?: ProjectRepository;
}) {
  return GovernanceCostService.create({
    ocsfEvents: undefined,
    gatewaySpend: deps.costRollup ? gatewayReturning() : undefined,
    projects: projectsReturning(),
    ...deps,
  });
}

/**
 * `hasSourceRows` answers the SOURCE-scoped existence read the billing note
 * makes, independently of the lane rows: the whole point of that read is that
 * another provider's lane rows say nothing about the Azure bill.
 */
function rollupReturning({
  rows = [],
  hasSourceRows = false,
  currencies,
}: {
  rows?: LaneRow[];
  hasSourceRows?: boolean;
  /**
   * What the per-currency read answers for the billed lane. Defaults to the
   * one US dollar line the pulled rows add up to, which is what every test
   * that says nothing about currency means: all of this money was billed in
   * dollars.
   */
  currencies?: CurrencyRow[];
} = {}) {
  const pulled = rows.filter((row) => row.costSource === "pulled");
  return {
    sumDaysByLane: vi.fn().mockResolvedValue(rows),
    sumWindowByCurrency: vi.fn().mockResolvedValue(
      currencies ?? [
        {
          currencyCode: "USD",
          amountNanoMinor: pulled.reduce(
            (sum, row) => sum + (row.amountNanoUsd ?? 0),
            0,
          ),
          cellsWithoutAmount: pulled.reduce(
            (count, row) => count + row.cellsWithoutAmount,
            0,
          ),
        },
      ],
    ),
    sumWindowByProvider: vi.fn().mockResolvedValue(
      rows
        .filter((row) => row.costSource === "pulled")
        .map((row) => ({
          provider: "openai_admin",
          amountNanoUsd: row.amountNanoUsd,
          cellsWithoutAmount: row.cellsWithoutAmount,
          currenciesWithoutUsdAmount: row.currenciesWithoutUsdAmount,
        })),
    ),
    hasRowsForSource: vi.fn().mockResolvedValue(hasSourceRows),
  } as unknown as GovernanceCostRollupClickHouseRepository;
}

/** One (day, lane) row, priced in dollars and complete, unless said otherwise. */
function laneRow(
  overrides: Partial<LaneRow> & { costSource: string },
): LaneRow {
  return {
    day: "2026-08-01",
    amountNanoUsd: 0,
    cellsWithoutAmount: 0,
    currenciesWithoutUsdAmount: [],
    // Never revised, and never observed by a pull — the shape of a day that
    // carries neither §15 marker, which is what most of this file is about.
    revisedAt: null,
    previousAmountNanoUsd: null,
    cellsWithoutPreviousAmount: 0,
    lastObservedAt: 0,
    // Not yet implemented: the day's figures split by the currency they were
    // billed in, each with what that currency held immediately before the
    // day's latest revision, and its own count of cells holding no earlier
    // amount. That count is per line rather than per day because the prior
    // figure is: a day billed in two currencies has two of each, and there is
    // no single number covering both. Empty by default, which is what every
    // test that says nothing about currency means.
    byCurrency: [],
    ...overrides,
  };
}

const NANO = 1_000_000_000;

describe("GovernanceCostService.summary", () => {
  it("keeps the billed headline and provider costs on the same read during ingestion", async () => {
    const costRollup = rollupReturning({
      rows: [laneRow({ costSource: "pulled", amountNanoUsd: 100 * NANO })],
    });
    Object.assign(costRollup, {
      sumWindowByProvider: vi.fn().mockResolvedValue([
        {
          provider: "openai_admin",
          amountNanoUsd: 101 * NANO,
          cellsWithoutAmount: 0,
          currenciesWithoutUsdAmount: [],
        },
      ]),
    });
    const result = await createService({
      prisma: prismaWithGovProject("gov-1"),
      costRollup,
    }).summary({ organizationId: "org-1", windowDays: 7 });
    expect(result.billed.amountUsd).toBe(101);
    expect(result.providers[0]?.amountUsd).toBe(result.billed.amountUsd);
  });
  it("reads provider amounts for the same tenant and window and withholds incomplete USD", async () => {
    const costRollup = rollupReturning();
    const readProviders = vi.fn().mockResolvedValue([
      {
        provider: "openai_admin",
        amountNanoUsd: 3 * NANO,
        cellsWithoutAmount: 0,
        currenciesWithoutUsdAmount: [],
      },
      {
        provider: "anthropic_admin",
        amountNanoUsd: 9 * NANO,
        cellsWithoutAmount: 1,
        currenciesWithoutUsdAmount: ["EUR"],
      },
      {
        provider: "copilot_studio",
        amountNanoUsd: -2 * NANO,
        cellsWithoutAmount: 0,
        currenciesWithoutUsdAmount: [],
      },
    ]);
    Object.assign(costRollup, { sumWindowByProvider: readProviders });
    const service = createService({
      prisma: prismaWithGovProject("gov-1"),
      costRollup,
    });
    const result = await service.summary({
      organizationId: "org-1",
      windowDays: 7,
      now: new Date("2026-08-07T12:00:00Z"),
    });
    expect(readProviders).toHaveBeenCalledWith({
      tenantId: "gov-1",
      fromDay: "2026-08-01",
      toDay: "2026-08-07",
    });
    expect(result.providers).toEqual([
      {
        provider: "openai_admin",
        amountUsd: 3,
        cellsWithoutAmount: 0,
        currenciesWithoutUsdAmount: [],
      },
      {
        provider: "anthropic_admin",
        amountUsd: null,
        cellsWithoutAmount: 1,
        currenciesWithoutUsdAmount: ["EUR"],
      },
      {
        provider: "copilot_studio",
        amountUsd: -2,
        cellsWithoutAmount: 0,
        currenciesWithoutUsdAmount: [],
      },
    ]);
  });
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
          costRollup: rollupReturning({ rows: [] }),
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
        // The billed lane comes from the rollup; the metered lane comes from
        // the gateway's own ledger, NOT the rollup. A gateway row left in the
        // rollup must never reach the metered figure.
        const rollup = rollupReturning({
          rows: [laneRow({ costSource: "pulled", amountNanoUsd: 12 * NANO })],
        });
        const service = createService({
          prisma: prismaWithGovProject("gov-1"),
          costRollup: rollup,
          gatewaySpend: gatewayReturning([
            gatewayDay({
              day: "2026-08-01",
              amountNanoUsd: 7 * NANO,
              requestCount: 1,
            }),
          ]),
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
          {
            day: "2026-08-01",
            billedUsd: 12,
            gatewayUsd: 7,
            billedCellsWithoutAmount: 0,
            gatewayCellsWithoutAmount: 0,
            // Neither row was ever revised or observed by a pull, so the day
            // carries neither §15 marker. Asserted exactly rather than by
            // `toMatchObject` so a marker appearing from nowhere fails here.
            billedRevisedAt: null,
            billedProvisional: false,
            // The day holds dollars and nothing else, and has never been
            // revised, so the one line names no earlier amount.
            billedByCurrency: [
              { currencyCode: "USD", amount: 12, previousAmount: null },
            ],
            // Nothing on this day is billed in anything but dollars, so the
            // dollar figure leaves nothing out and there is no currency to
            // name. Asserted as empty rather than omitted: the field is what
            // stops a partial figure reading as a day's total, and a day that
            // silently dropped it would look exactly like a complete one.
            billedCurrenciesWithoutUsdAmount: [],
          },
        ]);
      });
    });

    describe("when requesting a seven-day summary", () => {
      it("reads the window ending today, inclusive of both ends", async () => {
        const rollup = rollupReturning({ rows: [] });
        const service = createService({
          prisma: prismaWithGovProject("gov-1"),
          costRollup: rollup,
        });

        await service.summary({
          organizationId: "org-1",
          windowDays: 7,
          now: new Date("2026-08-10T00:00:00.000Z"),
        });

        // Pulled only: the billed day series must never count a gateway row
        // the retired fold left in the rollup.
        expect(rollup.sumDaysByLane).toHaveBeenCalledWith({
          tenantId: "gov-1",
          fromDay: "2026-08-04",
          toDay: "2026-08-10",
          costSource: "pulled",
        });
      });
    });
  });

  describe("given a lane whose rows carry no stated amount", () => {
    describe("when requesting the summary", () => {
      it("reports null for that lane and counts the unpriced cells", async () => {
        const service = createService({
          prisma: prismaWithGovProject("gov-1"),
          costRollup: rollupReturning({
            rows: [
              laneRow({
                costSource: "pulled",
                amountNanoUsd: null,
                cellsWithoutAmount: 3,
              }),
            ],
          }),
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

  describe("given a lane mixing dollar usage with usage billed elsewhere", () => {
    describe("when requesting the summary", () => {
      /** @scenario "A lane with usage we cannot state in US dollars holds no total" */
      it("withholds the dollar figure over an unpriced cell and totals the euros on their own line", async () => {
        // One figure, not two. The lane's per-currency lines REPLACE the
        // single dollar total, and the US dollar line among them IS that
        // total. What withholds it is a cell we hold no amount for AT ALL —
        // not a cell the provider priced in euros, which is money we can
        // state perfectly well and state on its own line.
        const service = createService({
          prisma: prismaWithGovProject("gov-1"),
          costRollup: rollupReturning({
            rows: [
              laneRow({
                day: "2026-08-01",
                costSource: "pulled",
                amountNanoUsd: 100 * NANO,
              }),
              laneRow({
                day: "2026-08-02",
                costSource: "pulled",
                amountNanoUsd: null,
                cellsWithoutAmount: 1,
              }),
            ],
            currencies: [
              // The dollar line: 100 stated, one cell holding nothing.
              {
                currencyCode: "USD",
                amountNanoMinor: 100 * NANO,
                cellsWithoutAmount: 1,
              },
              // Euros the provider DID state. Its own line, and no part of it
              // belongs to the dollar figure.
              {
                currencyCode: "EUR",
                amountNanoMinor: 40 * NANO,
                cellsWithoutAmount: 0,
              },
            ],
          }),
        });

        const result = await service.summary({
          organizationId: "org-1",
          windowDays: 30,
          now: new Date("2026-08-02T12:00:00.000Z"),
        });

        // The defect this exists to catch is 100 — the dollar part alone,
        // rendered under a label that reads as the lane's whole figure.
        expect(result.billed.amountUsd).toBeNull();
        expect(result.billed.amountUsd).not.toBe(100);
        expect(result.billed.cellsWithoutAmount).toBe(1);

        const dollars = result.billed.currencyTotals.find(
          (total) => total.currencyCode === "USD",
        );
        // ONE figure: the dollar line and the lane headline are the same
        // number, so a screen cannot show a withheld total beside a stated
        // one for the same money.
        expect(dollars?.amount).toBe(result.billed.amountUsd);
        expect(dollars?.cellsWithoutAmount).toBe(1);

        const euros = result.billed.currencyTotals.find(
          (total) => total.currencyCode === "EUR",
        );
        // Priced euros are not collateral damage: they keep their own total
        // even while the dollar line beside them is withheld.
        expect(euros?.amount).toBe(40);
        expect(euros?.cellsWithoutAmount).toBe(0);
        // And no line anywhere adds the two together.
        expect(
          result.billed.currencyTotals.map((total) => total.amount),
        ).not.toContain(140);
      });

      /** @scenario "A day mixing stated and unstated amounts holds no figure for that lane" */
      it("gaps the day over an amount it holds none of, keeps it over priced euros, and says what the figure leaves out", async () => {
        const service = createService({
          prisma: prismaWithGovProject("gov-1"),
          costRollup: rollupReturning({
            rows: [
              // A day the lane DID price part of, beside two cells holding no
              // amount in any currency: the partial figure exists and is
              // exactly what must not be plotted.
              laneRow({
                day: "2026-08-01",
                costSource: "pulled",
                amountNanoUsd: 60 * NANO,
                cellsWithoutAmount: 2,
              }),
              // The same shape of day under the new rule: every cell carries
              // an amount, some of them in euros. The dollar figure is real
              // and stands, and the day says the euros are not in it.
              laneRow({
                day: "2026-08-02",
                costSource: "pulled",
                amountNanoUsd: 60 * NANO,
                cellsWithoutAmount: 0,
                currenciesWithoutUsdAmount: ["EUR"],
              }),
            ],
          }),
          // The metered lane's day, from the ledger — a complete point that
          // keeps its figure while the billed day beside it is gapped.
          gatewaySpend: gatewayReturning([
            gatewayDay({
              day: "2026-08-01",
              amountNanoUsd: 7 * NANO,
              requestCount: 1,
            }),
          ]),
        });

        const result = await service.summary({
          organizationId: "org-1",
          windowDays: 30,
          now: new Date("2026-08-02T12:00:00.000Z"),
        });

        const day = result.series[0]!;
        expect(day.day).toBe("2026-08-01");
        // A gap, not a point at 60 sitting lower than the day really cost.
        expect(day.billedUsd).toBeNull();
        expect(day.billedCellsWithoutAmount).toBe(2);
        // The other lane is complete and keeps its point — otherwise this
        // would pass against an implementation that blanks the whole day.
        expect(day.gatewayUsd).toBe(7);
        expect(day.gatewayCellsWithoutAmount).toBe(0);

        const withEuros = result.series[1]!;
        expect(withEuros.day).toBe("2026-08-02");
        // Priced euros beside priced dollars is not a mixed day any more: the
        // dollar figure states every dollar spent, so gapping it here would
        // hide money we can stand behind.
        expect(withEuros.billedUsd).toBe(60);
        expect(withEuros.billedCellsWithoutAmount).toBe(0);
        // But the figure is not the whole day, so the day has to say which
        // money it leaves out — otherwise the bar reads as the day's total.
        expect(withEuros.billedCurrenciesWithoutUsdAmount).toEqual(["EUR"]);
      });
    });
  });

  describe("given a window billed in more than one currency", () => {
    describe("when the window totals are read", () => {
      /** @scenario "A currency nobody converted still totals in the currency it was billed in" */
      it("gives the euros a total of their own and leaves the dollar figure where it was", async () => {
        // The amount in the provider's own currency has been stored on every
        // row since the summary was built and has never been read by any
        // total. An empty dollar column is not the same as there being no
        // money, and no rate is applied to make one out of the other.
        const service = createService({
          prisma: prismaWithGovProject("gov-1"),
          costRollup: rollupReturning({
            rows: [
              laneRow({
                day: "2026-08-01",
                costSource: "pulled",
                amountNanoUsd: 100 * NANO,
              }),
            ],
            currencies: [
              {
                currencyCode: "USD",
                amountNanoMinor: 100 * NANO,
                cellsWithoutAmount: 0,
              },
              {
                currencyCode: "EUR",
                amountNanoMinor: 40 * NANO,
                cellsWithoutAmount: 0,
              },
            ],
          }),
        });

        const result = await service.summary({
          organizationId: "org-1",
          windowDays: 30,
          now: new Date("2026-08-01T12:00:00.000Z"),
        });

        const euros = result.billed.currencyTotals.find(
          (total) => total.currencyCode === "EUR",
        );
        expect(euros?.amount).toBe(40);

        // Unchanged by the euros beside it: not summed with them, and not
        // withheld because of them.
        expect(result.billed.amountUsd).toBe(100);
        expect(result.billed.amountUsd).not.toBe(140);
      });

      /** @scenario "A currency total is withheld when part of what it covers holds no amount" */
      it("withholds the euro total when part of what it covers holds no amount and says so", async () => {
        // Zero and "no amount at all" are written the same way in the
        // provider-currency figure, so the parts holding nothing are counted
        // separately. Without that count a day nobody ever priced charts as a
        // genuine nothing in the provider's own currency.
        const service = createService({
          prisma: prismaWithGovProject("gov-1"),
          costRollup: rollupReturning({
            rows: [
              laneRow({
                day: "2026-08-01",
                costSource: "pulled",
                amountNanoUsd: 100 * NANO,
              }),
            ],
            currencies: [
              {
                currencyCode: "USD",
                amountNanoMinor: 100 * NANO,
                cellsWithoutAmount: 0,
              },
              {
                currencyCode: "EUR",
                amountNanoMinor: 40 * NANO,
                cellsWithoutAmount: 1,
              },
            ],
          }),
        });

        const result = await service.summary({
          organizationId: "org-1",
          windowDays: 30,
          now: new Date("2026-08-01T12:00:00.000Z"),
        });

        const euros = result.billed.currencyTotals.find(
          (total) => total.currencyCode === "EUR",
        );
        // The defect this exists to catch is 40 — the priced part of the euro
        // spend, offered under a label that reads as all of it.
        expect(euros?.amount).toBeNull();
        expect(euros?.amount).not.toBe(40);
        // What the line says instead: part of what it covers is unpriced.
        expect(euros?.cellsWithoutAmount).toBe(1);
        // The dollar line covers different cells and is untouched by it.
        expect(result.billed.amountUsd).toBe(100);
      });
    });
  });

  describe("given a day whose bill was reissued in another currency", () => {
    describe("when the cost screen reads that day", () => {
      /** @scenario "A bill reissued in another currency reads as a revision, not as new spend" */
      it("names what each currency held before the reissue and sums none of them together", async () => {
        // A day's prior total is the sum of each cell's amount as it stood
        // IMMEDIATELY BEFORE that day's latest revision. Three buckets, not
        // two: a cell the revision revised contributes what it held before, a
        // cell the revision CREATED contributes nothing because it did not
        // exist yet, and an untouched cell contributes what it holds now.
        // Discriminating on "was revised" instead puts the created cell in the
        // untouched bucket, where it adds its new amount on top of the old
        // cell's prior one and the day claims it previously held about twice
        // what it did.
        //
        // Per currency, always. A reissue from one currency to another is
        // precisely a day holding two of them, so there is no single prior
        // figure for it: the day reads as having held dollars and now holding
        // euros, never as having held their sum.
        const revisedAtSeconds = Math.floor(
          Date.parse("2026-01-15T09:00:00.000Z") / 1000,
        );
        const service = createService({
          prisma: prismaWithGovProject("gov-1"),
          costRollup: rollupReturning({
            rows: [
              laneRow({
                day: "2026-01-15",
                costSource: "pulled",
                // The dollar cell was retracted to a stated zero, not removed:
                // a retraction is knowledge, not absence.
                amountNanoUsd: 0,
                cellsWithoutAmount: 0,
                revisedAt: revisedAtSeconds,
                previousAmountNanoUsd: 12 * NANO,
                cellsWithoutPreviousAmount: 0,
                byCurrency: [
                  {
                    currencyCode: "USD",
                    amountNanoMinor: 0,
                    previousAmountNanoMinor: 12 * NANO,
                    cellsWithoutAmount: 0,
                    cellsWithoutPreviousAmount: 0,
                  },
                  {
                    currencyCode: "EUR",
                    // The cell this reissue created. It holds the money now
                    // and held nothing at all before the revision. Nothing
                    // about it is unknown, so it withholds nothing — it names
                    // no earlier amount because there was none, which is a
                    // different thing from us not knowing one.
                    amountNanoMinor: 10 * NANO,
                    previousAmountNanoMinor: null,
                    cellsWithoutAmount: 0,
                    cellsWithoutPreviousAmount: 0,
                  },
                ],
              }),
            ],
          }),
        });

        const result = await service.summary({
          organizationId: "org-1",
          windowDays: 30,
          now: new Date("2026-01-15T12:00:00.000Z"),
        });

        const day = result.series[0]!;
        expect(day.day).toBe("2026-01-15");
        // The first Then: a currency change is the provider correcting one
        // charge, not a second charge arriving.
        expect(day.billedRevisedAt).toBe(revisedAtSeconds * 1000);

        const dollars = day.billedByCurrency.find(
          (line) => line.currencyCode === "USD",
        );
        const euros = day.billedByCurrency.find(
          (line) => line.currencyCode === "EUR",
        );

        // The second Then: what it held before, in the currency it held it in.
        expect(dollars?.previousAmount).toBe(12);
        expect(dollars?.amount).toBe(0);
        // The created cell names no earlier figure, because before the
        // revision there was nothing there to name.
        expect(euros?.previousAmount).toBeNull();
        expect(euros?.amount).toBe(10);

        // The defect the three buckets exist to prevent: 22 is the created
        // cell's new amount added on top of the retracted cell's prior one,
        // which is a figure the day never held.
        expect(dollars?.previousAmount).not.toBe(22);
        expect(
          day.billedByCurrency.map((line) => line.previousAmount),
        ).not.toContain(22);
      });
    });
  });

  describe("given metered spend recorded in the gateway ledger", () => {
    /** @scenario "The metered lane counts gateway spend from every project of the organization" */
    it("reads the ledger across every project tenant of the organization", async () => {
      const gateway = gatewayReturning([
        gatewayDay({
          day: "2026-08-01",
          amountNanoUsd: 3 * NANO,
          requestCount: 1,
          pricedRequestCount: 1,
        }),
        gatewayDay({
          day: "2026-08-02",
          amountNanoUsd: 4 * NANO,
          requestCount: 1,
          pricedRequestCount: 1,
        }),
      ]);
      const projects = projectsReturning(["proj-a", "proj-b"]);
      const service = createService({
        prisma: prismaWithGovProject("gov-1"),
        costRollup: rollupReturning({ rows: [] }),
        gatewaySpend: gateway,
        projects,
      });

      const result = await service.summary({
        organizationId: "org-1",
        windowDays: 7,
        now: new Date("2026-08-07T12:00:00.000Z"),
      });

      // The lane is the sum of the ledger's days, across the org's projects —
      // NOT the governance tenant the rollup reads under. The ids come from
      // the project repository, never from Prisma in this layer.
      expect(result.gateway.amountUsd).toBe(7);
      expect(projects.findAllIdsByOrganization).toHaveBeenCalledWith({
        organizationId: "org-1",
      });
      expect(gateway.sumDaysForOrganizationProjects).toHaveBeenCalledWith({
        tenantIds: ["proj-a", "proj-b"],
        fromDay: "2026-08-01",
        toDay: "2026-08-07",
      });
      // Both lanes keep their own figure in their own place.
      expect(result.series).toEqual([
        expect.objectContaining({ day: "2026-08-01", gatewayUsd: 3 }),
        expect.objectContaining({ day: "2026-08-02", gatewayUsd: 4 }),
      ]);
    });

    /** @scenario "Requests with no dollar amount are counted beside the metered total, not inside it" */
    it("shows the priced total and counts the requests with no dollar amount beside it", async () => {
      const service = createService({
        prisma: prismaWithGovProject("gov-1"),
        costRollup: rollupReturning({ rows: [] }),
        gatewaySpend: gatewayReturning([
          gatewayDay({
            day: "2026-08-01",
            amountNanoUsd: 10 * NANO,
            requestCount: 3,
            pricedRequestCount: 1,
            requestsWithoutAmount: 2,
          }),
        ]),
      });

      const result = await service.summary({
        organizationId: "org-1",
        windowDays: 30,
        now: new Date("2026-08-01T12:00:00.000Z"),
      });

      // The total is the priced requests only. The count rides beside it,
      // never inside it, and the metered lane still shows its total when the
      // count is above zero — the deliberate deviation from the billed lane's
      // withhold rule.
      expect(result.gateway.amountUsd).toBe(10);
      expect(result.gateway.requestsWithoutAmount).toBe(2);
      expect(result.series).toEqual([
        expect.objectContaining({ day: "2026-08-01", gatewayUsd: 10 }),
      ]);
      // The gateway never withholds a currency total, so it names no unpriced
      // cells and no foreign currency.
      expect(result.gateway.cellsWithoutAmount).toBe(0);
      expect(result.gateway.currenciesWithoutUsdAmount).toEqual([]);
    });

    /** @scenario "A window of only requests with no dollar amount still shows the metered lane" */
    it("holds no figure for a day of only charged requests the ledger could not price", async () => {
      const service = createService({
        prisma: prismaWithGovProject("gov-1"),
        costRollup: rollupReturning({ rows: [] }),
        gatewaySpend: gatewayReturning([
          gatewayDay({
            day: "2026-08-01",
            amountNanoUsd: 0,
            // Three requests, all charged, all priced at zero with tokens
            // consumed: the ledger cannot tell free from unpriced.
            requestCount: 3,
            pricedRequestCount: 0,
            requestsWithoutAmount: 3,
          }),
        ]),
      });

      const result = await service.summary({
        organizationId: "org-1",
        windowDays: 30,
        now: new Date("2026-08-01T12:00:00.000Z"),
      });

      // Charged requests alone do not make a figure. Every one of these is
      // in the unpriced count, so the zero sum is not a measurement — null,
      // never $0.00, which would say "free" where the ledger says "unknown".
      expect(result.gateway.amountUsd).toBeNull();
      expect(result.gateway.requestsWithoutAmount).toBe(3);
      expect(result.series).toEqual([
        expect.objectContaining({ day: "2026-08-01", gatewayUsd: null }),
      ]);
    });

    it("states $0.00 for a day of only requests that consumed nothing and cost nothing", async () => {
      const service = createService({
        prisma: prismaWithGovProject("gov-1"),
        costRollup: rollupReturning({ rows: [] }),
        gatewaySpend: gatewayReturning([
          gatewayDay({
            day: "2026-08-01",
            amountNanoUsd: 0,
            // Two failures before any token was consumed: charged, priced at
            // zero, and nothing about them is unknown.
            requestCount: 2,
            pricedRequestCount: 0,
            requestsWithoutAmount: 0,
          }),
        ]),
      });

      const result = await service.summary({
        organizationId: "org-1",
        windowDays: 30,
        now: new Date("2026-08-01T12:00:00.000Z"),
      });

      // Nothing spent and nothing unknown: zero is the honest figure.
      expect(result.gateway.amountUsd).toBe(0);
      expect(result.gateway.requestsWithoutAmount).toBe(0);
      expect(result.series).toEqual([
        expect.objectContaining({ day: "2026-08-01", gatewayUsd: 0 }),
      ]);
    });

    /** @scenario "A failed gateway ledger read never renders the metered lane as zero" */
    it("rejects the whole summary when the ledger read fails while the rollup resolves", async () => {
      const gateway = gatewayReturning();
      vi.mocked(gateway.sumDaysForOrganizationProjects).mockRejectedValue(
        new Error("gateway ledger is down"),
      );
      const service = createService({
        prisma: prismaWithGovProject("gov-1"),
        costRollup: rollupReturning({
          rows: [laneRow({ costSource: "pulled", amountNanoUsd: 12 * NANO })],
        }),
        gatewaySpend: gateway,
      });

      // A metered read that swallowed its failure would render an absence as a
      // measurement. It fails the summary, exactly as the rollup read does.
      await expect(
        service.summary({ organizationId: "org-1", windowDays: 30 }),
      ).rejects.toThrow("gateway ledger is down");
    });
  });

  describe("given a refund-heavy billed day", () => {
    describe("when requesting the summary", () => {
      it("passes the negative total through without interpretation", async () => {
        const service = createService({
          prisma: prismaWithGovProject("gov-1"),
          costRollup: rollupReturning({
            rows: [
              laneRow({
                costSource: "pulled",
                amountNanoUsd: -42.5 * NANO,
              }),
            ],
          }),
        });

        const result = await service.summary({
          organizationId: "org-1",
          windowDays: 30,
          now: new Date("2026-08-01T12:00:00.000Z"),
        });

        expect(result.billed.amountUsd).toBe(-42.5);
      });

      it("nets charges against refunds and still reports the negative", async () => {
        const service = createService({
          prisma: prismaWithGovProject("gov-1"),
          costRollup: rollupReturning({
            rows: [
              laneRow({
                costSource: "pulled",
                day: "2026-08-01",
                amountNanoUsd: 12.25 * NANO,
              }),
              laneRow({
                costSource: "pulled",
                day: "2026-08-02",
                amountNanoUsd: -30.75 * NANO,
              }),
            ],
          }),
        });

        const result = await service.summary({
          organizationId: "org-1",
          windowDays: 30,
          now: new Date("2026-08-03T12:00:00.000Z"),
        });

        expect(result.billed.amountUsd).toBe(-18.5);
      });
    });
  });

  describe("given a lane whose nano-dollar sum runs past the float-safe range", () => {
    describe("when requesting the summary", () => {
      it("reports every digit rather than the nearest float", async () => {
        // 2^53 nano-USD plus four single nano charges. Accumulated as floats
        // the four are swallowed whole, because each one lands exactly halfway
        // between two representable values and rounds back to where it
        // started. The lane is worth just over nine million dollars, which a
        // real organization can spend in a thirty-day window.
        const service = createService({
          prisma: prismaWithGovProject("gov-1"),
          costRollup: rollupReturning({
            rows: [
              laneRow({
                costSource: "pulled",
                day: "2026-08-01",
                amountNanoUsd: 9_007_199_254_740_992,
              }),
              ...["2026-08-02", "2026-08-03", "2026-08-04", "2026-08-05"].map(
                (day) =>
                  laneRow({ costSource: "pulled", day, amountNanoUsd: 1 }),
              ),
            ],
          }),
        });

        const result = await service.summary({
          organizationId: "org-1",
          windowDays: 30,
          now: new Date("2026-08-06T12:00:00.000Z"),
        });

        expect(result.billed.amountUsd).toBe(9_007_199.254_740_996);
        expect(result.billed.amountUsd).not.toBe(9_007_199.254_740_993);
      });
    });
  });
  describe("given the tenant's licence list has been read", () => {
    describe("when requesting the summary", () => {
      it("reports each pool's bought and assigned counts and no money", async () => {
        const service = createService({
          prisma: prismaWithGovProject("gov-1"),
          costRollup: rollupReturning({ rows: [] }),
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
          costRollup: rollupReturning({ rows: [] }),
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
          costRollup: rollupReturning({ rows: [] }),
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
          costRollup: rollupReturning({ rows: [] }),
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
          costRollup: rollupReturning({ rows: [] }),
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
          costRollup: rollupReturning({
            rows: [laneRow({ costSource: "pulled", amountNanoUsd: 12 * NANO })],
          }),
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
            sumWindowByProvider: vi.fn().mockResolvedValue([]),
            sumWindowByCurrency: vi.fn().mockResolvedValue([]),
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
          costRollup: rollupReturning({ rows: [] }),
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
          costRollup: rollupReturning({ rows: [] }),
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
          costRollup: rollupReturning({ rows: [] }),
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
    /** @scenario "A replacement Azure source restates the original bill" */
    it("recognizes bill rows stored under the original source after replacement", async () => {
      const rollup = rollupReturning();
      vi.mocked(rollup.hasRowsForSource).mockImplementation(
        async ({ ingestionSourceId }) => ingestionSourceId === "original",
      );
      const service = createService({
        prisma: prismaWithGovProject("gov-1", [
          {
            id: "replacement",
            parserConfig: {
              azureSubscriptionId: "subscription",
              _azureBillSourceId: "original",
            },
            pollerCursor: JSON.stringify({
              costPricedThroughDay: "2026-09-08",
              costHeldSinceMs: null,
            }),
          },
        ]),
        costRollup: rollup,
      });
      const result = await service.summary({
        organizationId: "org-1",
        windowDays: 30,
      });
      expect(result.azureBilling).toBeNull();
    });

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
          costRollup: rollupReturning({ rows: [] }),
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
          costRollup: rollupReturning({ rows: [] }),
        });

        const result = await service.summary({
          organizationId: "org-1",
          windowDays: 30,
        });

        expect(result.staleSources).toBeNull();
      });
    });
  });

  describe("given a source reads an Azure bill", () => {
    const SUBSCRIPTION = "00000000-0000-4000-8000-000000000001";
    const azureSource = (overrides: {
      azureBillingIsPrepaid?: boolean;
      pollerCursor?: unknown;
    }) => ({
      id: "src-azure",
      parserConfig: {
        adapter: "copilot_studio_dataverse",
        azureSubscriptionId: SUBSCRIPTION,
        ...(overrides.azureBillingIsPrepaid === undefined
          ? {}
          : { azureBillingIsPrepaid: overrides.azureBillingIsPrepaid }),
      },
      pollerCursor:
        overrides.pollerCursor ??
        JSON.stringify({
          costPricedThroughDay: "2026-08-30",
          costHeldSinceMs: null,
        }),
    });

    describe("when the bill was read clean and empty, with prepaid declared", () => {
      /** @scenario "A tenant that declared prepaid packs is told the bill cannot show them" */
      it("carries the prepaid note on the summary", async () => {
        const service = createService({
          prisma: prismaWithGovProject("gov-1", [
            azureSource({ azureBillingIsPrepaid: true }),
          ]),
          costRollup: rollupReturning({ rows: [] }),
        });

        const result = await service.summary({
          organizationId: "org-1",
          windowDays: 30,
        });

        expect(result.azureBilling).toBe("prepaid_declared");
        expect(result.billed.amountUsd).toBeNull();
      });
    });

    describe("when the bill was read clean and empty, with nothing declared", () => {
      /** @scenario "A tenant that declared nothing is never told it is prepaid" */
      it("says no spend was recorded, never prepaid", async () => {
        const service = createService({
          prisma: prismaWithGovProject("gov-1", [azureSource({})]),
          costRollup: rollupReturning({ rows: [] }),
        });

        const result = await service.summary({
          organizationId: "org-1",
          windowDays: 30,
        });

        expect(result.azureBilling).toBe("no_spend_recorded");
      });
    });

    describe("when the bill holds amounts, with prepaid declared", () => {
      /** @scenario "A declared-prepaid tenant whose bill has amounts sees the amounts" */
      it("shows the figure and carries no note to explain away", async () => {
        const service = createService({
          prisma: prismaWithGovProject("gov-1", [
            azureSource({ azureBillingIsPrepaid: true }),
          ]),
          costRollup: rollupReturning({
            rows: [laneRow({ costSource: "pulled", amountNanoUsd: 7 * NANO })],
            hasSourceRows: true,
          }),
        });

        const result = await service.summary({
          organizationId: "org-1",
          windowDays: 30,
        });

        expect(result.azureBilling).toBeNull();
        expect(result.billed.amountUsd).toBe(7);
      });
    });

    describe("when another pulled provider fills the lane while the bill is empty", () => {
      /** @scenario "A tenant that declared prepaid packs is told the bill cannot show them" */
      it("still carries the prepaid note — the lane's rows are not the bill's", async () => {
        // The defect this exists to catch: judging "has the bill been read"
        // off the whole pulled lane. An org running Copilot beside any other
        // pulled source always has lane rows, and the note would fall
        // permanently silent for exactly the tenants it was built for.
        const rollup = rollupReturning({
          rows: [laneRow({ costSource: "pulled", amountNanoUsd: 40 * NANO })],
          hasSourceRows: false,
        });
        const service = createService({
          prisma: prismaWithGovProject("gov-1", [
            azureSource({ azureBillingIsPrepaid: true }),
          ]),
          costRollup: rollup,
        });

        const result = await service.summary({
          organizationId: "org-1",
          windowDays: 30,
          now: new Date("2026-08-30T12:00:00.000Z"),
        });

        expect(result.azureBilling).toBe("prepaid_declared");
        // And the read must have been scoped to the claiming source, not the
        // lane — otherwise the fake above answered a different question.
        expect(rollup.hasRowsForSource).toHaveBeenCalledWith({
          tenantId: "gov-1",
          fromDay: "2026-08-01",
          toDay: "2026-08-30",
          costSource: "pulled",
          ingestionSourceId: "src-azure",
        });
      });

      it("still warns about a failed read the other provider's rows would have masked", async () => {
        const service = createService({
          prisma: prismaWithGovProject("gov-1", [
            azureSource({
              pollerCursor: JSON.stringify({
                costPricedThroughDay: null,
                costHeldSinceMs: 1_700_000_000_000,
              }),
            }),
          ]),
          costRollup: rollupReturning({
            rows: [laneRow({ costSource: "pulled", amountNanoUsd: 40 * NANO })],
            hasSourceRows: false,
          }),
        });

        const result = await service.summary({
          organizationId: "org-1",
          windowDays: 30,
        });

        expect(result.azureBilling).toBe("billing_read_failed");
      });
    });

    describe("when the stored cursor is one the puller itself would refuse", () => {
      it("stays silent rather than claiming a read the puller will redo", async () => {
        // The cursor is read through the puller's own schema. A hand-rolled
        // reader here accepted this malformed day and told the customer the
        // bill was read while the puller, refusing the same cursor, started
        // over from scratch.
        const service = createService({
          prisma: prismaWithGovProject("gov-1", [
            azureSource({
              azureBillingIsPrepaid: true,
              pollerCursor: JSON.stringify({
                costPricedThroughDay: "August 30, 2026",
                costHeldSinceMs: null,
              }),
            }),
          ]),
          costRollup: rollupReturning({ rows: [] }),
        });

        const result = await service.summary({
          organizationId: "org-1",
          windowDays: 30,
        });

        expect(result.azureBilling).toBeNull();
      });
    });

    describe("when the last read is held", () => {
      it("reports the failed read instead of an empty bill", async () => {
        const service = createService({
          prisma: prismaWithGovProject("gov-1", [
            azureSource({
              azureBillingIsPrepaid: true,
              pollerCursor: JSON.stringify({
                costPricedThroughDay: null,
                costHeldSinceMs: 1_700_000_000_000,
              }),
            }),
          ]),
          costRollup: rollupReturning({ rows: [] }),
        });

        const result = await service.summary({
          organizationId: "org-1",
          windowDays: 30,
        });

        expect(result.azureBilling).toBe("billing_read_failed");
      });
    });

    describe("when no source claims a subscription", () => {
      it("carries no note — there is no bill to explain", async () => {
        const service = createService({
          prisma: prismaWithGovProject("gov-1", [
            {
              parserConfig: { adapter: "copilot_studio_dataverse" },
              pollerCursor: null,
            },
          ]),
          costRollup: rollupReturning({ rows: [] }),
        });

        const result = await service.summary({
          organizationId: "org-1",
          windowDays: 30,
        });

        expect(result.azureBilling).toBeNull();
      });
    });
  });
});

/**
 * How much a day's figure can be trusted (ADR-128 §15).
 *
 * Both markers are DERIVED at read — one from the clock against a stored
 * observation, one from a stored revision — so this is the layer that decides
 * them, and the only layer where the clock is allowed to matter at all.
 *
 * Spec: specs/governance/governance-cost-restatement-markers.feature
 */
describe("GovernanceCostService.summary trust markers", () => {
  const NOW = new Date("2026-08-31T12:00:00.000Z");
  /** Unix seconds, the unit both `DateTime` markers arrive in. */
  const seconds = (iso: string) => Math.floor(Date.parse(iso) / 1000);

  async function seriesFor(rows: LaneRow[], gatewayDays: GatewayDayRow[] = []) {
    const service = createService({
      prisma: prismaWithGovProject("gov-1"),
      costRollup: rollupReturning({ rows }),
      gatewaySpend: gatewayReturning(gatewayDays),
    });
    const result = await service.summary({
      organizationId: "org-1",
      windowDays: 30,
      now: NOW,
    });
    return result.series;
  }

  describe("given a day a pull touched within the settling window", () => {
    /** @scenario "A day a pull touched recently can still change" */
    it("says the day can still change", async () => {
      const [day] = await seriesFor([
        laneRow({
          costSource: "pulled",
          amountNanoUsd: 9 * NANO,
          lastObservedAt: seconds("2026-08-30T04:00:00.000Z"),
        }),
      ]);

      expect(day?.billedProvisional).toBe(true);
    });
  });

  describe("given a day no pull has touched for longer than the settling window", () => {
    /** @scenario "A day no pull has touched for longer than the settling window reads settled" */
    it("says the day is settled", async () => {
      const [day] = await seriesFor([
        laneRow({
          costSource: "pulled",
          amountNanoUsd: 9 * NANO,
          // Thirty-one days before `now`: one day past the window.
          lastObservedAt: seconds("2026-07-31T04:00:00.000Z"),
        }),
      ]);

      // Anchored on the pull, never the calendar. A first connect backfills
      // ninety days at once, and a calendar test would call every one of them
      // settled the instant it landed, having been read exactly once.
      expect(day?.billedProvisional).toBe(false);
    });
  });

  describe("given a day that was restated and is still inside its window", () => {
    /** @scenario "A day that was revised and can still change says both" */
    it("reports both facts, because both are true", async () => {
      const [day] = await seriesFor([
        laneRow({
          costSource: "pulled",
          amountNanoUsd: 9 * NANO,
          revisedAt: seconds("2026-08-29T04:00:00.000Z"),
          previousAmountNanoUsd: 12 * NANO,
          lastObservedAt: seconds("2026-08-30T04:00:00.000Z"),
        }),
      ]);

      // Providers restate inside the same thirty days the settling window
      // covers, so the both-true day is the common case, not an edge one.
      expect(day?.billedRevisedAt).toBe(Date.parse("2026-08-29T04:00:00.000Z"));
      // What it held before, on the dollar line rather than as a figure of the
      // day's own. A day holds one earlier amount per currency and there is no
      // single number that covers a day billed in more than one.
      expect(
        day?.billedByCurrency.find((line) => line.currencyCode === "USD")
          ?.previousAmount,
      ).toBe(12);
      expect(day?.billedProvisional).toBe(true);
    });
  });

  describe("given a gateway day metered a moment ago", () => {
    /** @scenario "Gateway days never claim they might change" */
    it("never marks it as able to still change", async () => {
      // The metered day comes from the ledger now. It carries no §15 markers
      // at all — we metered it ourselves and nobody restates it — so the day's
      // billed markers stay null and it is never provisional.
      const [day] = await seriesFor(
        [],
        [
          gatewayDay({
            day: "2026-08-31",
            amountNanoUsd: 7 * NANO,
            requestCount: 1,
          }),
        ],
      );

      // We metered these ourselves and nobody restates them. Left in the
      // general rule they would carry "can still move" for thirty days on the
      // product's most-viewed and most-final numbers.
      expect(day?.gatewayUsd).toBe(7);
      expect(day?.billedProvisional).toBe(false);
      expect(day?.billedRevisedAt).toBeNull();
    });
  });

  describe("given a restated day part of which holds no dollar figure", () => {
    /** @scenario "A revised day whose earlier figure cannot be stated in dollars withholds it" */
    it("says it was revised but names no earlier amount", async () => {
      const [day] = await seriesFor([
        laneRow({
          costSource: "pulled",
          amountNanoUsd: 9 * NANO,
          revisedAt: seconds("2026-08-29T04:00:00.000Z"),
          previousAmountNanoUsd: 12 * NANO,
          cellsWithoutPreviousAmount: 1,
          lastObservedAt: seconds("2026-08-30T04:00:00.000Z"),
          byCurrency: [
            {
              currencyCode: "USD",
              amountNanoMinor: 9 * NANO,
              previousAmountNanoMinor: 12 * NANO,
              cellsWithoutAmount: 0,
              // Part of what the dollar line covered held no earlier amount,
              // so the line has no earlier figure to give.
              cellsWithoutPreviousAmount: 1,
            },
          ],
        }),
      ]);

      // A partial earlier figure reads as the whole one, which is the same lie
      // the lane total already refuses to tell. The rule follows the figure
      // onto the line it now lives on.
      expect(day?.billedRevisedAt).not.toBeNull();
      expect(
        day?.billedByCurrency.find((line) => line.currencyCode === "USD")
          ?.previousAmount,
      ).toBeNull();
    });
  });

  describe("given a day summarized before the markers existed", () => {
    /** @scenario "A day summarized before the markers existed reads as settled" */
    it("reads as neither revised nor changeable", async () => {
      const [day] = await seriesFor([
        laneRow({
          costSource: "pulled",
          amountNanoUsd: 9 * NANO,
          // The migration's backfill: no pull has ever been recorded against
          // this day. The pullers look thirty days back, so any day genuinely
          // still settling is re-stamped by the next daily pull.
          lastObservedAt: 0,
        }),
      ]);

      expect(day?.billedRevisedAt).toBeNull();
      expect(day?.billedProvisional).toBe(false);
    });
  });
});
