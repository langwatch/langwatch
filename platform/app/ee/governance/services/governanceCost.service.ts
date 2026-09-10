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

import { DiscoveredPersonRepository } from "@ee/governance/repositories/governanceIdentity.repository";
import type { GovernanceCostRollupClickHouseRepository } from "@ee/governance/services/governanceCostRollup.clickhouse.repository";
import type {
  GovernanceOcsfEventsClickHouseRepository,
  GovernanceSeatReportRow,
} from "@ee/governance/services/governanceOcsfEvents.clickhouse.repository";
import { resolveGovProjectId } from "@ee/governance/services/govProject";
import { noDataSinceNotice } from "@ee/governance/services/pullers/sourceHealth";
import { createLogger } from "@langwatch/observability";
import type { PrismaClient } from "~/generated/prisma/client";
import {
  nanoMinorToDecimalString,
  nanoUsdToDecimalString,
} from "~/server/gateway/wireMoney";
import {
  GOVERNANCE_COST_CURRENCY_USD,
  GOVERNANCE_COST_SOURCE,
  GOVERNANCE_SETTLING_WINDOW_DAYS,
} from "../projections/governanceCostRollup.constants";
import { azureBillSourceId } from "./activity-monitor/azureBillIdentity";
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
  /**
   * One total per currency the lane was BILLED in, sorted by code.
   *
   * These REPLACE the single dollar figure rather than sitting beside it: the
   * US dollar entry IS `amountUsd`, stated once, so a screen cannot show a
   * withheld total next to a stated one for the same money. Money the provider
   * priced in euros gets a line of its own instead of counting as money we
   * hold no amount for, and NO RATE is ever applied between two lines — there
   * is none to apply, and inventing one would put a number on the screen
   * nobody was charged (ADR-128 §3).
   */
  currencyTotals: GovernanceCostCurrencyTotalDto[];
}

/**
 * One currency's total for a lane.
 *
 * `amount` is in that currency's own units and is withheld under exactly the
 * same rule as the lane figure: any cell of the line holding no amount at all
 * withholds the whole line, because the priced part alone reads as the
 * complete one. Zero and "no amount at all" are written the same way in the
 * provider's own figure, which is why the count rides beside it.
 */
export interface GovernanceCostCurrencyTotalDto {
  /** ISO code, or empty for cells the provider named no currency for. */
  currencyCode: string;
  amount: number | null;
  cellsWithoutAmount: number;
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
   * The billed lane's day, split by the currency it was billed in, and what
   * each currency held immediately before `billedRevisedAt`.
   *
   * There is no single prior dollar figure any more, and that is the point: a
   * day reissued between two currencies that are not dollars has nothing such
   * a field could say, which is the case this whole batch exists to get right.
   * Each line's `previousAmount` is withheld under the same rule the figure
   * beside it is — a partial "was" reads as the whole one — and is null rather
   * than zero when the currency simply was not on this day before the
   * revision.
   */
  billedByCurrency: GovernanceCostDayCurrencyLineDto[];
  /**
   * Currencies whose spend the day's dollar figure LEAVES OUT, sorted.
   *
   * Needed because a mixed day now shows a dollar figure that is only part of
   * the day: money the provider priced in euros no longer withholds it. Left
   * unsaid, the bar would read as the day's total.
   */
  billedCurrenciesWithoutUsdAmount: string[];
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
 * One currency of one billed day: what it holds, and what it held immediately
 * before the day's latest revision.
 *
 * Amounts are in the currency's own units. Two lines are never added together
 * and no rate is applied between them.
 */
export interface GovernanceCostDayCurrencyLineDto {
  currencyCode: string;
  amount: number | null;
  /**
   * Null when the currency names no earlier amount — either it was not on this
   * day before the revision at all, or part of what the line covers can state
   * no prior figure and a partial "was" is withheld whole.
   */
  previousAmount: number | null;
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

/**
 * The window that was pulled while this organization was not recording pulled
 * cost, so its spend was never priced (ADR-088).
 *
 * A sibling of the notice above and the same kind of statement: those days
 * have audit rows and no money, which draws as zero and means unknown. The
 * difference is the cause — nothing broke, the organization had pulled cost
 * recording switched off — and so is the repair: turning it on stops the loss
 * but recovers nothing already read, because the cursor moved on. Re-reading
 * the window is what fills it in.
 */
export interface GovernanceCostUnpricedWindowDto {
  /** First day whose spend was dropped, across every affected source. */
  sinceIso: string;
  /** Last such day. Equal to `sinceIso` when only one day was lost. */
  throughIso: string;
  /** Names of the affected sources, alphabetical, so the notice can say which. */
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
  /** Pulled rollup costs by provider, regardless of person attribution. */
  providers: Array<{
    provider: string;
    amountUsd: number | null;
    cellsWithoutAmount: number;
  }>;
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
  /** Null when no source has read a day it was not allowed to price. */
  unpricedWindow: GovernanceCostUnpricedWindowDto | null;
}

/**
 * One row of the spender breakdown: a (provider, spender, agent) pairing and
 * what it spent over the window (ADR-128 §14 / ADR-129).
 *
 * A spender is (provider, rawActorId), never the id alone — that pair is the
 * discovered person's unique key, and one id string at two providers is two
 * people. A spender appears once PER AGENT they spent through, because the
 * agent is part of the rollup cell's key and folding it away would hide which
 * agent the money went through.
 */
export interface GovernanceSpenderRowDto {
  /** Empty only on the not-named bucket row. */
  provider: string;
  /** Empty only on the not-named bucket row. */
  rawActorId: string;
  /**
   * The discovered person's display text — the SAME word the People screen
   * labels them with — or the raw id when discovery has never seen this
   * spender. Null only on the not-named bucket row, whose copy belongs to the
   * screen: inventing a name here would put it in every future consumer.
   */
  label: string | null;
  /** Empty when the provider named no agent for these rows. */
  agentId: string;
  /** Withheld (null) unless every cell behind it is priced in USD. */
  amountUsd: number | null;
  cellsWithoutAmount: number;
}

/**
 * One (day, provider) figure of the billed lane.
 *
 * A separate figure per pair, never one for the day and one for the provider:
 * the whole point is to say which provider a day belongs to.
 */
export interface GovernanceCostProviderDayRowDto {
  /** `YYYY-MM-DD`, the provider's business day in UTC. */
  day: string;
  provider: string;
  /** Withheld (null) unless every cell behind it holds an amount. */
  amountUsd: number | null;
  cellsWithoutAmount: number;
}

export interface GovernanceCostProviderDayBreakdownDto {
  unavailableReason: GovernanceCostUnavailableReason | null;
  /** Oldest day first, provider-alphabetical within a day. Empty while unavailable. */
  rows: GovernanceCostProviderDayRowDto[];
  windowDays: number;
}

/**
 * One model's spend over the window.
 *
 * The model string is repeated EXACTLY as the provider billed it. A provider
 * that charges per token kind sends a line item rather than a bare model name,
 * and the puller stores it unsplit on purpose; re-cutting it here would invent
 * a grouping the bill does not make and merge two figures a reader may need
 * apart.
 */
export interface GovernanceCostModelRowDto {
  /** Empty when the provider's rows named no model. */
  model: string;
  /** Withheld (null) unless every cell behind it is priced in USD. */
  amountUsd: number | null;
  cellsWithoutAmount: number;
}

export interface GovernanceCostModelBreakdownDto {
  unavailableReason: GovernanceCostUnavailableReason | null;
  /** Largest spend first; withheld figures last. Empty while unavailable. */
  rows: GovernanceCostModelRowDto[];
  windowDays: number;
}

/**
 * One record behind a (day, provider) figure: what it was for and what it
 * cost.
 *
 * Two facts and no third. The screen asked for what a charge was for and what
 * it came to, and every extra dimension offered here is one a reader has to
 * decide to ignore.
 */
export interface GovernanceCostDayRecordDto {
  /** The model, and the agent beside it when the provider named one. */
  label: string;
  amountUsd: number | null;
  cellsWithoutAmount: number;
}

export interface GovernanceCostDayRecordsDto {
  unavailableReason: GovernanceCostUnavailableReason | null;
  /** Largest figure first, withheld ones after. Empty while unavailable. */
  records: GovernanceCostDayRecordDto[];
}

export interface GovernanceSpenderBreakdownDto {
  unavailableReason: GovernanceCostUnavailableReason | null;
  /**
   * Largest figure first, unpriced rows after, and the not-named bucket —
   * every row whose day predates the naming line or whose provider names
   * nobody — always last: it is a remainder, not a person outspending
   * everyone. Empty while unavailable, and empty rather than zero-filled when
   * the window holds no pulled rows.
   */
  rows: GovernanceSpenderRowDto[];
  windowDays: number;
}

/** A lane nobody has a figure for. Null, never zero — see the file header. */
function laneWithoutFigure(): GovernanceCostLaneDto {
  return {
    amountUsd: null,
    cellsWithoutAmount: 0,
    currenciesWithoutUsdAmount: [],
    currencyTotals: [],
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
    providers: [],
    gateway: laneWithoutFigure(),
    azureBilling: null,
    seats: { status: "awaiting_data" },
    series: [],
    windowDays,
    // An unavailable screen has no lanes to caveat. The reason it prints
    // already outranks "a source stopped pulling" and "a day went unpriced".
    staleSources: null,
    unpricedWindow: null,
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
    const [
      rows,
      seats,
      staleSources,
      azureBilling,
      unpricedWindow,
      providers,
      billedCurrencies,
    ] = await Promise.all([
      costRollup.sumDaysByLane({ tenantId, fromDay, toDay }),
      this.readSeats({ tenantId }),
      this.readStaleSources({ organizationId }),
      this.readAzureBillingNote({ organizationId, tenantId, fromDay, toDay }),
      this.readUnpricedWindow({ organizationId }),
      costRollup.sumWindowByProvider({ tenantId, fromDay, toDay }),
      // The billed lane's currency lines come from their OWN window read
      // rather than from folding the day rows, because the lane's headline
      // does too. Both describe the same snapshot that way, which is the
      // guarantee the read below the comment is about; folding one from days
      // and reading the other from the window would let a backfill land
      // between them and put two answers for the same money on one card.
      costRollup.sumWindowByCurrency({
        tenantId,
        fromDay,
        toDay,
        costSource: GOVERNANCE_COST_SOURCE.PULLED,
      }),
    ]);

    return {
      unavailableReason: null,
      // Ingestion can advance between reads. The headline and provider bars
      // must describe the same snapshot, even while a backfill is writing.
      billed: {
        ...spenderFigure(providers),
        currenciesWithoutUsdAmount: [
          ...new Set(
            providers.flatMap((row) => row.currenciesWithoutUsdAmount),
          ),
        ].sort(),
        currencyTotals: currencyTotalsFrom(billedCurrencies),
      },
      providers: providers.map((row) => ({
        provider: row.provider,
        ...spenderFigure([row]),
      })),
      gateway: totalFor(rows, GOVERNANCE_COST_SOURCE.GATEWAY),
      azureBilling,
      seats,
      series: seriesFrom(rows, now),
      windowDays,
      staleSources,
      unpricedWindow,
    };
  }

  /**
   * Who spent the pulled money over the trailing window, labeled in the words
   * the People screen uses.
   *
   * Reads the PULLED lane only — the repository's predicate, not a caller
   * convention — and labels each (provider, spender) against that provider's
   * own discovery row. An id discovery has never seen is shown as itself;
   * blank ids (every day before the naming line, and every provider that
   * names nobody) gather into one bucket row rather than an invented person.
   *
   * The caller must hold the People screen's permission as well as the cost
   * one: the labels ARE that screen's data, and the cost permission alone
   * buys figures, not names. The router enforces it; this method trusts its
   * caller the same way `summary` does.
   */
  async spenderBreakdown({
    organizationId,
    windowDays,
    now = new Date(),
  }: {
    organizationId: string;
    windowDays: number;
    now?: Date;
  }): Promise<GovernanceSpenderBreakdownDto> {
    const { costRollup, prisma } = this.deps;
    if (!costRollup) {
      return { unavailableReason: "no_cost_store", rows: [], windowDays };
    }
    const tenantId = await resolveGovProjectId({ prisma, organizationId });
    if (!tenantId) {
      return {
        unavailableReason: "no_governance_project",
        rows: [],
        windowDays,
      };
    }

    const toDay = utcDay(now);
    const fromDay = utcDay(
      new Date(now.getTime() - (windowDays - 1) * 86_400_000),
    );

    const [groups, people] = await Promise.all([
      costRollup.sumWindowBySpender({ tenantId, fromDay, toDay }),
      this.people.listByOrganization(prisma, { organizationId }),
    ]);

    // Keyed by (provider, id) — the person's unique key. Keying on the id
    // alone would hand one provider's person another provider's name.
    const displayTextBySpender = new Map(
      people.map((p) => [spenderKey(p.provider, p.rawActorId), p.displayText]),
    );

    const named = groups.filter((g) => g.rawActorId !== "");
    const blank = groups.filter((g) => g.rawActorId === "");

    const rows: GovernanceSpenderRowDto[] = named.map((g) => ({
      provider: g.provider,
      rawActorId: g.rawActorId,
      label:
        displayTextBySpender.get(spenderKey(g.provider, g.rawActorId)) ??
        g.rawActorId,
      agentId: g.agentId,
      ...spenderFigure([g]),
    }));
    rows.sort(
      (a, b) =>
        (b.amountUsd ?? -1) - (a.amountUsd ?? -1) ||
        (a.label ?? "").localeCompare(b.label ?? ""),
    );

    if (blank.length > 0) {
      // One bucket across providers and agents: nobody was named, and a
      // per-provider split of "nobody" would dress the remainder up as rows.
      rows.push({
        provider: "",
        rawActorId: "",
        label: null,
        agentId: "",
        ...spenderFigure(blank),
      });
    }

    return { unavailableReason: null, rows, windowDays };
  }

  /**
   * The billed lane split by day AND provider over the window.
   *
   * The screen could already say what a provider cost over a quarter, and what
   * the organization spent on a given day. It could not say which provider
   * caused a day that stood out, which is the first question anybody asks of a
   * day that stood out.
   *
   * Each figure obeys the same withholding rule as every other on this screen:
   * a (day, provider) holding any cell we have no amount for states no figure,
   * because the priced part alone reads as the whole one and the reader has no
   * way to see it is short.
   */
  async dailyByProvider({
    organizationId,
    windowDays,
    now = new Date(),
  }: {
    organizationId: string;
    windowDays: number;
    now?: Date;
  }): Promise<GovernanceCostProviderDayBreakdownDto> {
    const { costRollup, prisma } = this.deps;
    if (!costRollup) {
      return { unavailableReason: "no_cost_store", rows: [], windowDays };
    }
    const tenantId = await resolveGovProjectId({ prisma, organizationId });
    if (!tenantId) {
      return {
        unavailableReason: "no_governance_project",
        rows: [],
        windowDays,
      };
    }

    const toDay = utcDay(now);
    const fromDay = utcDay(
      new Date(now.getTime() - (windowDays - 1) * 86_400_000),
    );
    const groups = await costRollup.sumDaysByProvider({
      tenantId,
      fromDay,
      toDay,
    });

    return {
      unavailableReason: null,
      rows: groups.map((group) => ({
        day: group.day,
        provider: group.provider,
        ...spenderFigure([group]),
      })),
      windowDays,
    };
  }

  /**
   * The billed lane split by MODEL over the window, largest first.
   *
   * This panel used to read the metered trace store, which in a deployment
   * whose only money arrives on pulled bills holds nothing — so a screen with
   * a fully populated `Model` column sat there reporting "nothing in this
   * window yet". Same rollup as every other figure on this screen now, which
   * is also what makes it add up against the billed lane beside it.
   *
   * Ordered by spend rather than alphabetically, because the panel is a ranked
   * list and the question it answers is which model costs the most. A withheld
   * figure sorts last: it is not a small number, it is an unknown one, and
   * putting it at the top or in the middle would read as a measurement.
   *
   * Each figure obeys the same withholding rule as every other on this screen:
   * a model holding any cell we have no USD amount for states no figure,
   * because the priced part alone reads as the whole one.
   */
  async spendByModel({
    organizationId,
    windowDays,
    now = new Date(),
  }: {
    organizationId: string;
    windowDays: number;
    now?: Date;
  }): Promise<GovernanceCostModelBreakdownDto> {
    const { costRollup, prisma } = this.deps;
    if (!costRollup) {
      return { unavailableReason: "no_cost_store", rows: [], windowDays };
    }
    const tenantId = await resolveGovProjectId({ prisma, organizationId });
    if (!tenantId) {
      return {
        unavailableReason: "no_governance_project",
        rows: [],
        windowDays,
      };
    }

    const toDay = utcDay(now);
    const fromDay = utcDay(
      new Date(now.getTime() - (windowDays - 1) * 86_400_000),
    );
    const groups = await costRollup.sumWindowByModel({
      tenantId,
      fromDay,
      toDay,
    });

    const rows = groups.map((group) => ({
      model: group.model,
      ...spenderFigure([group]),
    }));
    // Sorted here rather than in SQL: the ordering is over the WITHHELD figure,
    // which only exists once the withholding rule has been applied, and that
    // rule lives in this layer.
    rows.sort((left, right) => {
      if (left.amountUsd === null && right.amountUsd === null) {
        return left.model.localeCompare(right.model);
      }
      if (left.amountUsd === null) return 1;
      if (right.amountUsd === null) return -1;
      if (right.amountUsd !== left.amountUsd) {
        return right.amountUsd - left.amountUsd;
      }
      // Ties broken by name so the list does not reshuffle between reads.
      return left.model.localeCompare(right.model);
    });

    return { unavailableReason: null, rows, windowDays };
  }

  /**
   * The records behind ONE PERIOD at ONE provider: what each was for, and what
   * it cost.
   *
   * "What it was for" is the model, and the agent beside it when the provider
   * named one — those are the dimensions the figure was grouped by, so the
   * records add up to exactly the figure a reader clicked and no residue is
   * left over for them to wonder about.
   *
   * A PERIOD, not a day: the screen this answers has no day interval to offer
   * — month, quarter and year are the widths its Time Interval chip carries —
   * so the bar a reader clicks always covers a span. The span arrives already
   * resolved to its first and last day, because the fold that decided where
   * one period ends and the next begins lives on the screen and there is no
   * second copy of that arithmetic here to disagree with it.
   */
  async periodRecords({
    organizationId,
    fromDay,
    toDay,
    provider,
  }: {
    organizationId: string;
    /** `YYYY-MM-DD`, the period's first day in UTC, included. */
    fromDay: string;
    /** `YYYY-MM-DD`, the period's last day in UTC, included. */
    toDay: string;
    provider: string;
  }): Promise<GovernanceCostDayRecordsDto> {
    const { costRollup, prisma } = this.deps;
    if (!costRollup) {
      return { unavailableReason: "no_cost_store", records: [] };
    }
    const tenantId = await resolveGovProjectId({ prisma, organizationId });
    if (!tenantId) {
      return { unavailableReason: "no_governance_project", records: [] };
    }

    const groups = await costRollup.sumPeriodRecordsByProvider({
      tenantId,
      fromDay,
      toDay,
      provider,
    });

    return {
      unavailableReason: null,
      records: groups
        .map((group) => ({
          label: recordLabel(group),
          ...spenderFigure([group]),
        }))
        .sort(
          (a, b) =>
            (b.amountUsd ?? -1) - (a.amountUsd ?? -1) ||
            a.label.localeCompare(b.label),
        ),
    };
  }

  private readonly people = new DiscoveredPersonRepository();

  /**
   * The span of days that were pulled but never priced, across every source.
   *
   * Reported for the whole organization rather than clipped to the drawn
   * window, for the same reason `readStaleSources` counts sources that
   * produced no rows: a gap that predates the window is exactly the one a
   * reader is least likely to find on their own, and clipping it would hide
   * the worst case. The screen says which days, so a gap outside the window
   * reads as history rather than as a caveat on the figures on screen.
   */
  private async readUnpricedWindow({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<GovernanceCostUnpricedWindowDto | null> {
    const sources = await this.deps.prisma.ingestionSource.findMany({
      where: {
        organizationId,
        archivedAt: null,
        unpricedUsageSince: { not: null },
      },
      select: {
        name: true,
        unpricedUsageSince: true,
        unpricedUsageThrough: true,
      },
    });
    // Re-checked here rather than trusted from the query. A source with no
    // recorded loss has nothing to say, and reducing an empty list — or one
    // holding an absent date — would throw on a screen whose whole job is to
    // keep working when a figure is missing.
    const lost = sources.flatMap((source) => {
      const since = source.unpricedUsageSince;
      if (!since) return [];
      return [
        {
          name: source.name,
          since,
          through: source.unpricedUsageThrough ?? since,
        },
      ];
    });
    if (lost.length === 0) return null;

    const since = lost.reduce((earliest, source) =>
      source.since < earliest.since ? source : earliest,
    ).since;
    const through = lost.reduce((latest, source) =>
      source.through > latest.through ? source : latest,
    ).through;

    return {
      sinceIso: since.toISOString(),
      throughIso: through.toISOString(),
      sourceNames: lost.map((source) => source.name).sort(),
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
      // The notice has two shapes, and this guard is a FENCE FOR LATER rather
      // than a filter doing work today: the call above passes neither
      // `completeness` nor `readThroughAt`, so the read-through shape is
      // currently unreachable from here and every non-null notice names a last
      // success.
      //
      // It stays because the day someone selects those two columns and passes
      // them through -- which is a one-line change and an obvious one to make
      // -- the read-through point would otherwise land in a field called
      // "oldest last success" and date an outage from a run that never failed.
      // A page-capped run did not fail. That is a wrong answer wearing the
      // shape of a right one, which survives review far better than a crash.
      //
      // The sources screen already reports the read-through point in its own
      // words. Whether this screen should say anything separate about a
      // half-read source is deliberately unanswered: no scenario asks for it,
      // and inventing the sentence would commit us to a meaning nobody agreed.
      if (notice === null || !("lastSuccessIso" in notice)) return [];
      return [{ name: source.name, lastSuccessIso: notice.lastSuccessIso }];
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
        ingestionSourceId: azureBillSourceId(claiming),
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

/**
 * One (day, lane) row, exactly as the repository answers it.
 *
 * DERIVED rather than restated. It used to be a hand-written mirror of the
 * repository's return type, which is a second place to remember: a field added
 * to the read landed here as a compile error only if somebody thought to
 * copy it, and a field whose meaning changed would not have shown up at all.
 */
type LaneRow = Awaited<
  ReturnType<GovernanceCostRollupClickHouseRepository["sumDaysByLane"]>
>[number];

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
type SpenderGroup = Awaited<
  ReturnType<GovernanceCostRollupClickHouseRepository["sumWindowBySpender"]>
>[number];

/**
 * What one record was for, in the provider's own words.
 *
 * The model alone when that is all the provider named, and "model (agent)"
 * when it named both — one spender spends through several agents and a list
 * showing the model twice with two different figures reads as a bug. Neither
 * is translated or prettified here: a reader matches this against the
 * provider's own invoice, and a name we improved is a name that no longer
 * matches.
 */
function recordLabel({
  model,
  agentId,
}: {
  model: string;
  agentId: string;
}): string {
  if (model === "" && agentId === "") return "Not named";
  if (agentId === "") return model;
  if (model === "") return agentId;
  return `${model} (${agentId})`;
}

/** NUL never appears in a provider name, so the key cannot be forged by an id. */
function spenderKey(provider: string, rawActorId: string): string {
  return `${provider}\u0000${rawActorId}`;
}

/**
 * A spender row's figure, under the same withholding rule as every lane
 * total (`figureFor`): any unpriced cell withholds the whole figure, because
 * the priced part alone reads as the complete one.
 */
function spenderFigure(
  rows: readonly Pick<SpenderGroup, "amountNanoUsd" | "cellsWithoutAmount">[],
): {
  amountUsd: number | null;
  cellsWithoutAmount: number;
} {
  const withoutAmount = rows.reduce(
    (count, row) => count + row.cellsWithoutAmount,
    0,
  );
  const priced = rows.filter((row) => row.amountNanoUsd !== null);
  if (priced.length === 0) {
    return { amountUsd: null, cellsWithoutAmount: withoutAmount };
  }
  const totalNanoUsd = priced.reduce(
    (sum, row) => sum + BigInt(row.amountNanoUsd ?? 0),
    0n,
  );
  return {
    amountUsd: usdFigure({ totalNanoUsd, cellsWithoutAmount: withoutAmount }),
    cellsWithoutAmount: withoutAmount,
  };
}

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
 * One figure in a currency that may not be dollars, under the same withholding
 * rule every other figure on this screen obeys.
 *
 * `nanoMinorToDecimalString` rather than the USD one because nothing about the
 * arithmetic is dollar-specific — the stored unit is nano of the currency's
 * major unit either way — and calling the USD function would be a claim about
 * the currency in the name of a value that is not in it.
 */
function minorFigure({
  totalNanoMinor,
  cellsWithoutAmount,
}: {
  totalNanoMinor: number | null;
  cellsWithoutAmount: number;
}): number | null {
  if (cellsWithoutAmount > 0 || totalNanoMinor === null) return null;
  return Number(nanoMinorToDecimalString(BigInt(totalNanoMinor)));
}

/** The lane's per-currency window totals, as the per-currency read answers them. */
function currencyTotalsFrom(
  rows: readonly {
    currencyCode: string;
    amountNanoMinor: number | null;
    cellsWithoutAmount: number;
  }[],
): GovernanceCostCurrencyTotalDto[] {
  return rows
    .map((row) => ({
      currencyCode: row.currencyCode,
      amount: minorFigure({
        totalNanoMinor: row.amountNanoMinor,
        cellsWithoutAmount: row.cellsWithoutAmount,
      }),
      cellsWithoutAmount: row.cellsWithoutAmount,
    }))
    .sort((a, b) => a.currencyCode.localeCompare(b.currencyCode));
}

/**
 * A lane's per-currency window totals folded from its own DAY rows.
 *
 * Used for the gateway lane, whose headline is folded from the same rows, so
 * the lines and the figure over them describe one snapshot. The billed lane
 * takes its lines from the window read instead, for exactly the same reason —
 * see the comment on that read in `summary`.
 */
function currencyTotalsFoldedFrom(
  rows: readonly LaneRow[],
): GovernanceCostCurrencyTotalDto[] {
  const byCode = new Map<
    string,
    { amountNanoMinor: number | null; cellsWithoutAmount: number }
  >();
  for (const row of rows) {
    for (const line of row.byCurrency) {
      const held = byCode.get(line.currencyCode) ?? {
        amountNanoMinor: null,
        cellsWithoutAmount: 0,
      };
      byCode.set(line.currencyCode, {
        amountNanoMinor:
          line.amountNanoMinor === null
            ? held.amountNanoMinor
            : (held.amountNanoMinor ?? 0) + line.amountNanoMinor,
        cellsWithoutAmount: held.cellsWithoutAmount + line.cellsWithoutAmount,
      });
    }
  }
  return currencyTotalsFrom(
    [...byCode.entries()].map(([currencyCode, held]) => ({
      currencyCode,
      ...held,
    })),
  );
}

/**
 * The billed day's currency lines, and what each held before its revision.
 *
 * A day whose read answers no currency lines at all falls back to the single
 * US dollar line the day-level figures already describe. That is not a shape
 * the store produces — a day that holds cells holds at least one currency —
 * but a day read through anything that answers only the day-level fields
 * still holds dollars, and a card with no line at all would say the day held
 * nothing.
 */
function dayCurrencyLinesFrom(
  row: LaneRow,
): GovernanceCostDayCurrencyLineDto[] {
  if (row.byCurrency.length === 0) {
    return [
      {
        currencyCode: GOVERNANCE_COST_CURRENCY_USD,
        amount: figureFor([row]),
        previousAmount: previousFigureFor(row),
      },
    ];
  }
  return row.byCurrency.map((line) => ({
    currencyCode: line.currencyCode,
    amount: minorFigure({
      totalNanoMinor: line.amountNanoMinor,
      cellsWithoutAmount: line.cellsWithoutAmount,
    }),
    // A day nobody revised names no earlier amount on any of its lines: there
    // is no moment to have held something before, and the marker that would
    // carry it is not rendered anyway.
    previousAmount:
      row.revisedAt === null
        ? null
        : minorFigure({
            totalNanoMinor: line.previousAmountNanoMinor,
            cellsWithoutAmount: line.cellsWithoutPreviousAmount,
          }),
  }));
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
    currencyTotals: currencyTotalsFoldedFrom(lane),
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
      billedByCurrency: [],
      billedCurrenciesWithoutUsdAmount: [],
      billedProvisional: false,
    };
    if (row.costSource === GOVERNANCE_COST_SOURCE.PULLED) {
      entry.billedUsd = figureFor([row]);
      entry.billedCellsWithoutAmount = row.cellsWithoutAmount;
      entry.billedRevisedAt =
        row.revisedAt === null ? null : row.revisedAt * 1000;
      entry.billedByCurrency = dayCurrencyLinesFrom(row);
      entry.billedCurrenciesWithoutUsdAmount = row.currenciesWithoutUsdAmount;
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
