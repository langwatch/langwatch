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
 * DTO says which kind of absence it is. There is no `?? 0` in this service, and
 * adding one is the defect `specs/governance/governance-cost-screen.feature`
 * exists to prevent.
 *
 * Spec: specs/governance/governance-cost-screen.feature
 */

import type { GovernanceCostRollupClickHouseRepository } from "@ee/governance/services/governanceCostRollup.clickhouse.repository";
import { resolveGovProjectId } from "@ee/governance/services/govProject";
import type { PrismaClient } from "~/generated/prisma/client";
import { GOVERNANCE_COST_SOURCE } from "../projections/governanceCostRollup.constants";

/** Nano-USD per USD. The rollup stores integer nano units, never floats. */
const NANO_PER_USD = 1_000_000_000;

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
   * The lane's total, or null when we hold no figure for it. NEVER 0 as a
   * stand-in for absence — 0 is a real amount and charts as free usage.
   */
  amountUsd: number | null;
  /** Cells the producer summarized without stating a USD figure. */
  cellsWithoutAmount: number;
}

/**
 * The seat lane, which has no producer in wave 1.
 *
 * It carries no amount FIELD at all, rather than an amount that happens to be
 * null. A renderer cannot print a fabricated zero from a value that does not
 * exist, so the guarantee is enforced by the type rather than by a convention
 * every future caller has to remember. The seats PR replaces this shape with a
 * real lane; until then the absence is structural.
 */
export interface GovernanceSeatLaneDto {
  status: "awaiting_data";
}

/** One day of the per-lane series. Either lane may hold no figure that day. */
export interface GovernanceCostDayDto {
  /** `YYYY-MM-DD`, the provider's business day in UTC. */
  day: string;
  billedUsd: number | null;
  gatewayUsd: number | null;
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
  seats: GovernanceSeatLaneDto;
  /** Oldest day first. Empty while unavailable. */
  series: GovernanceCostDayDto[];
  windowDays: number;
}

/** A lane nobody has a figure for. Null, never zero — see the file header. */
function laneWithoutFigure(): GovernanceCostLaneDto {
  return { amountUsd: null, cellsWithoutAmount: 0 };
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
    seats: { status: "awaiting_data" },
    series: [],
    windowDays,
  };
}

/** Integer nano-USD to USD, preserving null. */
function toUsd(amountNanoUsd: number | null): number | null {
  return amountNanoUsd === null ? null : amountNanoUsd / NANO_PER_USD;
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
    },
  ) {}

  static create({
    prisma,
    costRollup,
  }: {
    prisma: PrismaClient;
    costRollup: GovernanceCostRollupClickHouseRepository | undefined;
  }): GovernanceCostService {
    return new GovernanceCostService({ prisma, costRollup });
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

    const rows = await costRollup.sumDaysByLane({
      tenantId,
      fromDay,
      toDay,
    });

    return {
      unavailableReason: null,
      billed: totalFor(rows, GOVERNANCE_COST_SOURCE.PULLED),
      gateway: totalFor(rows, GOVERNANCE_COST_SOURCE.GATEWAY),
      seats: { status: "awaiting_data" },
      series: seriesFrom(rows),
      windowDays,
    };
  }
}

type LaneRow = {
  day: string;
  costSource: string;
  amountNanoUsd: number | null;
  cellsWithoutAmount: number;
};

/**
 * One lane's window total.
 *
 * A lane with no rows at all, and a lane whose every row holds no figure, both
 * come back null. Only rows that actually carry an amount contribute, so the
 * total is never a partial sum dressed up as a complete one without
 * `cellsWithoutAmount` saying so.
 */
function totalFor(
  rows: readonly LaneRow[],
  costSource: string,
): GovernanceCostLaneDto {
  const lane = rows.filter((row) => row.costSource === costSource);
  const priced = lane.filter((row) => row.amountNanoUsd !== null);
  return {
    amountUsd: priced.length
      ? toUsd(priced.reduce((sum, row) => sum + (row.amountNanoUsd ?? 0), 0))
      : null,
    cellsWithoutAmount: lane.reduce(
      (count, row) => count + row.cellsWithoutAmount,
      0,
    ),
  };
}

/**
 * The per-day series, oldest first.
 *
 * A day only appears if some lane reported it. A day one lane reported and the
 * other did not carries null for the silent lane — not 0, which would draw a
 * line down to the axis and read as a day of free usage.
 */
function seriesFrom(rows: readonly LaneRow[]): GovernanceCostDayDto[] {
  const byDay = new Map<string, GovernanceCostDayDto>();
  for (const row of rows) {
    const entry = byDay.get(row.day) ?? {
      day: row.day,
      billedUsd: null,
      gatewayUsd: null,
    };
    if (row.costSource === GOVERNANCE_COST_SOURCE.PULLED) {
      entry.billedUsd = toUsd(row.amountNanoUsd);
    } else if (row.costSource === GOVERNANCE_COST_SOURCE.GATEWAY) {
      entry.gatewayUsd = toUsd(row.amountNanoUsd);
    }
    byDay.set(row.day, entry);
  }
  return [...byDay.values()].sort((a, b) => a.day.localeCompare(b.day));
}
