// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * The cost screen's read side (ADR-128 wave 1).
 *
 * Three lanes, side by side, each labeled for what it is and NEVER summed into
 * one figure: what the provider billed, what the gateway metered, and seats.
 * They measure different things and disagree on purpose — a single total would
 * be a number nobody is owed.
 *
 * DELIBERATE DEVIATION from the house degrade pattern. The precedent
 * (`personalUsage.service.ts`'s `emptySummary`) returns a shape full of ZEROS
 * when its repository is absent, and for a usage dashboard that is fine. Here
 * it would be a lie about money: `$0.00` is a claim that nothing was spent, and
 * it charts as a real free day. So every absence in this file is `null` and the
 * DTO says which kind of absence it is.
 *
 * Exactly one `?? 0` survives, in `figureFor`, and it is there to narrow a
 * type rather than to supply a figure: the rows it runs over have already been
 * filtered to those whose `amountNanoUsd !== null`, so the branch cannot be
 * taken and no absent amount can reach it. Any OTHER `?? 0` — one that could
 * actually fire on missing data — is the defect
 * `specs/governance/governance-cost-screen.feature` exists to prevent.
 *
 * A partial sum is the same lie in a subtler shape, and `figureFor` is the one
 * place it is refused: a figure is offered only when EVERY cell behind it
 * carries a USD amount. Adding up the priced part of a mixed lane produces a
 * number that reads as the whole and is short by an amount nothing on the
 * screen discloses.
 *
 * Spec: specs/governance/governance-cost-screen.feature
 */

import type { GovernanceCostRollupClickHouseRepository } from "@ee/governance/services/governanceCostRollup.clickhouse.repository";
import type {
  GovernanceOcsfEventsClickHouseRepository,
  GovernanceSeatReportRow,
} from "@ee/governance/services/governanceOcsfEvents.clickhouse.repository";
import { resolveGovProjectId } from "@ee/governance/services/govProject";
import { noDataSinceNotice } from "@ee/governance/services/pullers/sourceHealth";
import { createLogger } from "@langwatch/observability";
import type { PrismaClient } from "~/generated/prisma/client";
import { nanoUsdToDecimalString } from "~/server/gateway/wireMoney";
import {
  GOVERNANCE_COST_SOURCE,
  GOVERNANCE_SETTLING_WINDOW_DAYS,
} from "../projections/governanceCostRollup.constants";
import {
  readClaimedSubscription,
  readPrepaidDeclared,
} from "./activity-monitor/azureBillOwnership";
import {
  azureBillingNoteFrom,
  type GovernanceAzureBillingNote,
} from "./azureBillingNote";
import { readStoredCostCursor } from "./pullers/copilotStudioDataverse.puller";

const logger = createLogger("langwatch:governance:cost");

/**
 * Why the screen holds no figures at all.
 *
 * `no_cost_store` — the deployment has no ClickHouse, so cost was never
 * recorded anywhere. `no_governance_project` — the store exists but this
 * organization has never ingested anything, so there is nothing to summarize
 * yet. Both render as "unavailable"; they are distinguished so the copy can
 * eventually tell a customer which one they are looking at.
 */
export type GovernanceCostUnavailableReason =
  | "no_cost_store"
  | "no_governance_project";

/** One lane's figure. `amountUsd` is null whenever no figure is held. */
export interface GovernanceCostLaneDto {
  /**
   * The lane's total, or null when we hold no figure we can stand behind.
   * NEVER 0 as a stand-in for absence — 0 is a real amount and charts as free
   * usage.
   *
   * Null covers two different situations and `cellsWithoutAmount` tells them
   * apart: zero means the lane reported nothing at all, and anything above
   * zero means the lane DID report but part of it has no USD figure, so the
   * total is withheld rather than partial.
   */
  amountUsd: number | null;
  /**
   * Cells the producer summarized without stating a USD figure. Above zero,
   * `amountUsd` is null by construction: totalling the rest would understate
   * the lane by however much was left out, under a label that reads as the
   * whole figure.
   */
  cellsWithoutAmount: number;
  /**
   * Which currencies those cells were billed in, sorted, USD excluded. Empty
   * when nothing names one — the screen then says a total is withheld without
   * claiming a currency it cannot support.
   */
  currenciesWithoutUsdAmount: string[];
}

/**
 * One licence pool on the seat lane.
 *
 * Counts only, and there is no amount FIELD anywhere on this lane — not even a
 * null one. A renderer cannot print a fabricated price from a value that does
 * not exist, so the guarantee is enforced by the type rather than by a
 * convention every future caller has to remember. What the seats cost is
 * already on the invoice the billed lane reads; a figure derived from a unit
 * count here would show the customer the same spend twice.
 */
export interface GovernanceSeatPoolDto {
  /** The provider's own part number for the licence, e.g. `VIRTUAL_AGENT_USL`. */
  skuPartNumber: string;
  /** `YYYY-MM-DD`, the day the count belongs to. */
  day: string;
  seatsBought: number;
  seatsAssigned: number;
}

/**
 * The seat lane: nothing countable has been read, the read itself failed, or
 * the pools that were read.
 *
 * A union rather than a list that may be empty, because the three states read
 * differently to a customer. "No licence list has been read for you", "we
 * tried to read it and could not", and "your licence list holds these seats"
 * are three different sentences, and only one of them is true at a time.
 */
export type GovernanceSeatLaneDto =
  | { status: "awaiting_data" }
  | { status: "read_failed" }
  | { status: "reported"; pools: GovernanceSeatPoolDto[] };

/**
 * One day of the per-lane series. Either lane may hold no figure that day.
 *
 * The per-lane unpriced counts ride along so a reader can tell a day nothing
 * was reported for from a day whose figure is withheld. Both plot as a gap —
 * the counts are what let the chart explain the gap rather than leave it
 * looking like lost data.
 */
export interface GovernanceCostDayDto {
  /** `YYYY-MM-DD`, the provider's business day in UTC. */
  day: string;
  billedUsd: number | null;
  gatewayUsd: number | null;
  /** Billed-lane cells that day holding no USD figure. */
  billedCellsWithoutAmount: number;
  /** Gateway-lane cells that day holding no USD figure. */
  gatewayCellsWithoutAmount: number;

  /**
   * When the provider last restated this day, epoch ms, or null if never
   * (ADR-128 §15). Billed lane only, and not for symmetry's sake: a gateway
   * outcome is priced once as it is served and nothing ever restates it, so a
   * gateway field here could only ever be null and would invite a reader to
   * wonder what a non-null one would have meant.
   */
  billedRevisedAt: number | null;
  /**
   * What the billed lane said this day cost before that restatement. Null when
   * no restatement happened, and null when any cell of the day can state no
   * prior figure — a partial "was" reads as the whole one, which is the same
   * lie `billedUsd` refuses to tell.
   */
  billedPreviousUsd: number | null;
  /**
   * Whether the day is still inside its settling window, i.e. a pull touched
   * it recently enough that the provider may still move it (§15).
   *
   * DERIVED at read from when a pull last touched the day, never stored: the
   * answer changes with the clock, so a stored flag would only be a stale one.
   * Orthogonal to `billedRevisedAt` — "already moved" and "can still move" are
   * independent facts and the common case is both.
   */
  billedProvisional: boolean;
}

/**
 * The point after which the lanes are missing at least one source (ADR-128 §4a).
 *
 * A source that has stopped pulling is not asked about anything, so it reports
 * no spend, so the lanes quietly fall. That is indistinguishable on screen
 * from a cheap month, and it is the difference between "we spent nothing" and
 * "we do not know" — which is why this is surfaced rather than left to the
 * source pages, where only someone already suspicious would look.
 *
 * The date is the OLDEST last-success among the stopped sources, because the
 * totals stop being complete at the first one that fell over, not the last.
 */
export interface GovernanceCostStaleSourcesDto {
  /** Oldest successful pull among the sources that have stopped. */
  oldestLastSuccessIso: string;
  /** Names of the stopped sources, alphabetical, so the notice can say which. */
  sourceNames: string[];
}

export interface GovernanceCostSummaryDto {
  /**
   * Null when the screen has figures to show. Non-null means every lane is
   * empty for a structural reason, and the screen says so instead of drawing
   * zeros.
   */
  unavailableReason: GovernanceCostUnavailableReason | null;
  /** What the provider billed, pulled from their own reporting. */
  billed: GovernanceCostLaneDto;
  /** What the gateway metered as it served the traffic. */
  gateway: GovernanceCostLaneDto;
  /**
   * Why the Azure bill shows nothing, when a source claims one. Null when no
   * bill is claimed, when the figures already speak for themselves, or when
   * the first read has not completed yet. See `azureBillingNote.ts` for the
   * closed list and its sentences.
   */
  azureBilling: GovernanceAzureBillingNote | null;
  seats: GovernanceSeatLaneDto;
  /** Oldest day first. Empty while unavailable. */
  series: GovernanceCostDayDto[];
  windowDays: number;
  /** Null when every source is still pulling. */
  staleSources: GovernanceCostStaleSourcesDto | null;
}

/** A lane nobody has a figure for. Null, never zero — see the file header. */
function laneWithoutFigure(): GovernanceCostLaneDto {
  return {
    amountUsd: null,
    cellsWithoutAmount: 0,
    currenciesWithoutUsdAmount: [],
  };
}

function unavailable({
  reason,
  windowDays,
}: {
  reason: GovernanceCostUnavailableReason;
  windowDays: number;
}): GovernanceCostSummaryDto {
  return {
    unavailableReason: reason,
    billed: laneWithoutFigure(),
    gateway: laneWithoutFigure(),
    azureBilling: null,
    seats: { status: "awaiting_data" },
    series: [],
    windowDays,
    // An unavailable screen has no lanes to caveat. The reason it prints
    // already outranks "a source stopped pulling".
    staleSources: null,
  };
}

/** `YYYY-MM-DD` for a UTC instant. */
function utcDay(at: Date): string {
  return at.toISOString().slice(0, 10);
}

export class GovernanceCostService {
  constructor(
    private readonly deps: {
      prisma: PrismaClient;
      /**
       * The daily cost rollup, from the App. `undefined` on a deployment with
       * no ClickHouse — which makes the screen UNAVAILABLE, not free.
       */
      costRollup: GovernanceCostRollupClickHouseRepository | undefined;
      /**
       * Where the licence reads land. `undefined` on the same deployment the
       * rollup is absent from, and the seat lane then reports awaiting rather
       * than none — an absent store has read no licences, which is exactly
       * what awaiting says.
       */
      ocsfEvents: GovernanceOcsfEventsClickHouseRepository | undefined;
    },
  ) {}

  static create({
    prisma,
    costRollup,
    ocsfEvents,
  }: {
    prisma: PrismaClient;
    costRollup: GovernanceCostRollupClickHouseRepository | undefined;
    ocsfEvents: GovernanceOcsfEventsClickHouseRepository | undefined;
  }): GovernanceCostService {
    return new GovernanceCostService({ prisma, costRollup, ocsfEvents });
  }

  /**
   * The three lanes and their per-day series over the trailing window.
   *
   * `now` is injectable so a test can pin the window without freezing the
   * clock globally; production never passes it.
   */
  async summary({
    organizationId,
    windowDays,
    now = new Date(),
  }: {
    organizationId: string;
    windowDays: number;
    now?: Date;
  }): Promise<GovernanceCostSummaryDto> {
    const { costRollup, prisma } = this.deps;
    if (!costRollup) {
      return unavailable({ reason: "no_cost_store", windowDays });
    }

    // TenantId of every rollup row for this organization. Absent until the
    // org's first ingestion source is minted.
    const tenantId = await resolveGovProjectId({ prisma, organizationId });
    if (!tenantId) {
      return unavailable({ reason: "no_governance_project", windowDays });
    }

    const toDay = utcDay(now);
    const fromDay = utcDay(
      new Date(now.getTime() - (windowDays - 1) * 86_400_000),
    );

    // The seat read carries its own failure; the cost read does not. A broken
    // licence read costs the screen one lane, so it degrades to `read_failed`
    // and the money lanes still render — never to "awaiting data", which
    // would tell a customer their licences have not been read when what
    // actually happened is that we could not read them. A broken COST read
    // still fails the whole summary: this screen is about money, and a money
    // lane that swallowed its own failure would render an absence as a
    // measurement.
    const [rows, seats, staleSources, azureBilling] = await Promise.all([
      costRollup.sumDaysByLane({ tenantId, fromDay, toDay }),
      this.readSeats({ tenantId }),
      this.readStaleSources({ organizationId }),
      this.readAzureBillingNote({ organizationId, tenantId, fromDay, toDay }),
    ]);

    return {
      unavailableReason: null,
      billed: totalFor(rows, GOVERNANCE_COST_SOURCE.PULLED),
      gateway: totalFor(rows, GOVERNANCE_COST_SOURCE.GATEWAY),
      azureBilling,
      seats,
      series: seriesFrom(rows, now),
      windowDays,
      staleSources,
    };
  }

  /**
   * Which sources have stopped pulling, and how far back the lanes are whole.
   *
   * Every non-archived source counts, not only the ones that produced rows in
   * this window. A source broken for longer than the window produces nothing
   * at all, and that is precisely the case where the screen most needs to say
   * so — filtering on "contributed recently" would hide the worst outages.
   */
  private async readStaleSources({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<GovernanceCostStaleSourcesDto | null> {
    const sources = await this.deps.prisma.ingestionSource.findMany({
      where: { organizationId, archivedAt: null },
      select: {
        name: true,
        status: true,
        errorCount: true,
        lastSuccessAt: true,
      },
    });

    const stopped = sources.flatMap((source) => {
      const notice = noDataSinceNotice({
        status: source.status,
        errorCount: source.errorCount,
        lastSuccessAt: source.lastSuccessAt,
      });
      return notice
        ? [{ name: source.name, lastSuccessIso: notice.lastSuccessIso }]
        : [];
    });
    if (stopped.length === 0) return null;

    // Both ISO strings are UTC and fixed-width, so ordering them as text
    // orders them as instants.
    const oldest = stopped.reduce((earliest, candidate) =>
      candidate.lastSuccessIso < earliest.lastSuccessIso ? candidate : earliest,
    );

    return {
      oldestLastSuccessIso: oldest.lastSuccessIso,
      sourceNames: stopped.map((source) => source.name).sort(),
    };
  }

  /**
   * The Azure billing note, from the source that claims the bill.
   *
   * The spend check is scoped to the CLAIMING SOURCE's rows, not to the
   * pulled lane: the lane is fed by every pulled provider on the picker, so
   * an org running Copilot beside another pulled source would otherwise have
   * that provider's rows silence every sentence about the Azure bill —
   * including the warning that its read failed.
   *
   * At most one live source can claim a given SUBSCRIPTION (the ownership
   * guard refuses a second), but nothing stops two sources claiming two
   * different ones. `createdAt` order makes which claim speaks deterministic
   * — the oldest — rather than Postgres row order; one note for two bills is
   * recorded as an open question in ADR-128 §21.
   */
  private async readAzureBillingNote({
    organizationId,
    tenantId,
    fromDay,
    toDay,
  }: {
    organizationId: string;
    tenantId: string;
    fromDay: string;
    toDay: string;
  }): Promise<GovernanceAzureBillingNote | null> {
    const { costRollup, prisma } = this.deps;
    if (!costRollup) return null;
    const sources = await prisma.ingestionSource.findMany({
      where: { organizationId, archivedAt: null },
      select: { id: true, parserConfig: true, pollerCursor: true },
      orderBy: { createdAt: "asc" },
    });
    const claiming = sources.find(
      (source) =>
        readClaimedSubscription(
          source.parserConfig as Record<string, unknown> | null,
        ) !== null,
    );
    if (!claiming) return null;

    const parserConfig = claiming.parserConfig as Record<
      string,
      unknown
    > | null;
    const cursor = readStoredCostCursor(claiming.pollerCursor);
    return azureBillingNoteFrom({
      hasSubscriptionClaim: true,
      isPrepaidDeclared: readPrepaidDeclared(parserConfig),
      hasAzureSpendRows: await costRollup.hasRowsForSource({
        tenantId,
        fromDay,
        toDay,
        costSource: GOVERNANCE_COST_SOURCE.PULLED,
        ingestionSourceId: claiming.id,
      }),
      costPricedThroughDay: cursor.costPricedThroughDay,
      costHeldSinceMs: cursor.costHeldSinceMs,
    });
  }

  /**
   * The seat lane, or the fact that it could not be read.
   *
   * Logged at error, because a lane that says "could not be read" to a
   * customer forever, and to nobody else ever, is a lane nobody is fixing.
   */
  private async readSeats({
    tenantId,
  }: {
    tenantId: string;
  }): Promise<GovernanceSeatLaneDto> {
    const { ocsfEvents } = this.deps;
    if (!ocsfEvents) return { status: "awaiting_data" };
    try {
      return seatsFrom(await ocsfEvents.findLatestSeatReports({ tenantId }));
    } catch (error) {
      logger.error(
        { error, tenantId },
        "Governance seat read failed; the seat lane reports the failure while the cost lanes render",
      );
      return { status: "read_failed" };
    }
  }
}

/**
 * Whether a licence pool is a seat somebody is paying for.
 *
 * All four facts, and the reason is a live tenant: the naive count said 27
 * unused seats when the true answer was 2. A company-wide pool can never be
 * assigned to anyone, so it reports zero assigned forever; a free pool arrives
 * with ten thousand units because the number caps how far it may spread rather
 * than saying what anyone bought; a suspended pool stopped being paid for; and
 * a pool that is none of the agent products is somebody's mailbox, not their
 * agent. Each of those produces a loud, plausible, wrong finding on its own,
 * and it buries the handful of paid agent seats that really are sitting empty.
 *
 * The uncounted pools are still on the record — the licence read keeps every
 * pool it saw, with the facts that classify it — so nothing is lost here that
 * a later question cannot ask.
 */
function isCountableSeatPool(pool: GovernanceSeatReportRow): boolean {
  return pool.perPerson && pool.live && !pool.free && pool.seatStem;
}

/**
 * The seat lane from the licence pools that were read.
 *
 * Pools sorted by part number so the lane does not reshuffle between reads,
 * and a lane with nothing countable says awaiting rather than reporting an
 * empty list — a screen showing "0 pools" would be a claim about a licence
 * list nobody could count.
 */
function seatsFrom(
  reports: readonly GovernanceSeatReportRow[],
): GovernanceSeatLaneDto {
  const pools = reports
    .filter(isCountableSeatPool)
    .map((pool) => ({
      skuPartNumber: pool.skuPartNumber,
      day: pool.day,
      seatsBought: pool.seatsBought,
      seatsAssigned: pool.seatsAssigned,
    }))
    .sort((a, b) => a.skuPartNumber.localeCompare(b.skuPartNumber));

  return pools.length
    ? { status: "reported", pools }
    : { status: "awaiting_data" };
}

type LaneRow = {
  day: string;
  costSource: string;
  amountNanoUsd: number | null;
  cellsWithoutAmount: number;
  currenciesWithoutUsdAmount: string[];
  /** Unix SECONDS — see the repository; these two are `DateTime` columns. */
  revisedAt: number | null;
  previousAmountNanoUsd: number | null;
  cellsWithoutPreviousAmount: number;
  lastObservedAt: number;
};

/**
 * Nano-USD to the dollar figure the screen renders, or null.
 *
 * The one place nano-USD becomes a JavaScript number, so the BigInt discipline
 * holds everywhere upstream of it: a window total in nano-USD crosses 2^53 at
 * roughly nine million dollars, and a float accumulator starts dropping low
 * digits there without saying so.
 *
 * `cellsWithoutAmount` above zero withholds the figure entirely rather than
 * stating the part that could be priced. That partial number reads as the
 * whole one and is short by an amount nothing on the screen discloses.
 */
function usdFigure({
  totalNanoUsd,
  cellsWithoutAmount,
}: {
  totalNanoUsd: bigint | null;
  cellsWithoutAmount: number;
}): number | null {
  if (cellsWithoutAmount > 0 || totalNanoUsd === null) return null;
  return Number(nanoUsdToDecimalString(totalNanoUsd));
}

/**
 * Whether a day may still move, from when a pull last touched it (§15).
 *
 * PULL-anchored, not calendar-anchored, and the difference is the whole rule.
 * On first connect a puller backfills 90 days, so a calendar test would call
 * every day older than the window settled the instant it landed, having been
 * read exactly once. A source pulled weekly would go the other way and keep
 * days provisional long after the provider stopped touching them. What we can
 * honestly claim to know is when we last looked, so that is what it reads.
 *
 * Zero means never observed — a row written before the marker existed — and
 * reads as settled, which is what the backfill was designed to say.
 */
function isWithinSettlingWindow({
  lastObservedAtSeconds,
  windowDays,
  now,
}: {
  lastObservedAtSeconds: number;
  windowDays: number;
  now: Date;
}): boolean {
  if (lastObservedAtSeconds <= 0) return false;
  return now.getTime() - lastObservedAtSeconds * 1000 < windowDays * 86_400_000;
}

/**
 * The figure for a set of rows, withheld unless every cell behind it is priced
 * in USD.
 *
 * This is the rule the whole read side turns on. Summing the priced cells and
 * ignoring the rest produces a smaller number that still reads as the complete
 * one, and the difference is invisible: the screen would understate what an
 * organization spent by exactly the part it could not state, under a label
 * claiming to be the total. There is no honest way to render that, so it is
 * not rendered — a figure we cannot vouch for is no figure.
 */
function figureFor(rows: readonly LaneRow[]): number | null {
  const withoutAmount = rows.reduce(
    (count, row) => count + row.cellsWithoutAmount,
    0,
  );
  const priced = rows.filter((row) => row.amountNanoUsd !== null);
  if (priced.length === 0) return null;
  // Summed in BigInt and divided by reading the digits out, per ADR-128 §3.
  const totalNanoUsd = priced.reduce(
    (sum, row) => sum + BigInt(row.amountNanoUsd ?? 0),
    0n,
  );
  return usdFigure({ totalNanoUsd, cellsWithoutAmount: withoutAmount });
}

/**
 * What the billed lane said a day cost in the moment before its latest
 * restatement, under the same withholding rule as the figure it is shown
 * beside.
 *
 * "Before the latest one", not "before all of them": a day restated twice
 * shows only the most recent move, and the repository pins the prior total to
 * that same moment. The full chain lives in the event log, never in this
 * figure (ADR-128 §15).
 *
 * Null when the day was never revised: there is no earlier figure to name, and
 * the marker that would carry it is not rendered anyway.
 */
function previousFigureFor(row: LaneRow): number | null {
  if (row.revisedAt === null) return null;
  return usdFigure({
    totalNanoUsd:
      row.previousAmountNanoUsd === null
        ? null
        : BigInt(row.previousAmountNanoUsd),
    cellsWithoutAmount: row.cellsWithoutPreviousAmount,
  });
}

/**
 * One lane's window total.
 *
 * A lane with no rows at all, a lane whose every row holds no figure, and a
 * lane holding a mix all come back null; `cellsWithoutAmount` is what tells
 * the three apart, and the currencies say what the unpriced part was billed
 * in.
 */
function totalFor(
  rows: readonly LaneRow[],
  costSource: string,
): GovernanceCostLaneDto {
  const lane = rows.filter((row) => row.costSource === costSource);
  return {
    amountUsd: figureFor(lane),
    cellsWithoutAmount: lane.reduce(
      (count, row) => count + row.cellsWithoutAmount,
      0,
    ),
    currenciesWithoutUsdAmount: [
      ...new Set(lane.flatMap((row) => row.currenciesWithoutUsdAmount)),
    ].sort(),
  };
}

/**
 * The per-day series, oldest first.
 *
 * A day only appears if some lane reported it. A day one lane reported and the
 * other did not carries null for the silent lane — not 0, which would draw a
 * line down to the axis and read as a day of free usage.
 *
 * A day whose lane holds a mix of priced and unpriced cells carries null too,
 * for the same reason the window total does: a point plotted at the priced
 * part sits lower than the day actually cost, and a reader has no way to see
 * that it is short. A gap is the one shape that cannot be misread.
 */
function seriesFrom(
  rows: readonly LaneRow[],
  now: Date,
): GovernanceCostDayDto[] {
  const byDay = new Map<string, GovernanceCostDayDto>();
  for (const row of rows) {
    const entry = byDay.get(row.day) ?? {
      day: row.day,
      billedUsd: null,
      gatewayUsd: null,
      billedCellsWithoutAmount: 0,
      gatewayCellsWithoutAmount: 0,
      billedRevisedAt: null,
      billedPreviousUsd: null,
      billedProvisional: false,
    };
    if (row.costSource === GOVERNANCE_COST_SOURCE.PULLED) {
      entry.billedUsd = figureFor([row]);
      entry.billedCellsWithoutAmount = row.cellsWithoutAmount;
      entry.billedRevisedAt =
        row.revisedAt === null ? null : row.revisedAt * 1000;
      entry.billedPreviousUsd = previousFigureFor(row);
      // The settling window is per SOURCE, and this row spans every source the
      // billed lane holds that day. Every source runs on the default today —
      // only Anthropic's window has been measured, and the rest are provisional
      // constants until they are — so the default is exactly right here rather
      // than an approximation. It stops being so the day a source is measured
      // to differ, and that is the day this read has to group by source.
      entry.billedProvisional = isWithinSettlingWindow({
        lastObservedAtSeconds: row.lastObservedAt,
        windowDays: GOVERNANCE_SETTLING_WINDOW_DAYS,
        now,
      });
    } else if (row.costSource === GOVERNANCE_COST_SOURCE.GATEWAY) {
      entry.gatewayUsd = figureFor([row]);
      entry.gatewayCellsWithoutAmount = row.cellsWithoutAmount;
      // The gateway lane is EXEMPT from both markers (§15). We metered these
      // rows ourselves in real time and no provider restates them, so "can
      // still move" on the product's most-viewed and most-final numbers would
      // be a warning about a thing that cannot happen.
    }
    byDay.set(row.day, entry);
  }
  return [...byDay.values()].sort((a, b) => a.day.localeCompare(b.day));
}
