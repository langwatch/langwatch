// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/** Main's `governanceCost.summary` figures: every absence is `null`, never `$0`. @see specs/governance/governance-cost-screen.feature */
import type {
  GovernanceCostCurrencyTotal,
  GovernanceCostDay,
  GovernanceCostDayCurrencyLine,
  GovernanceCostLane,
  GovernanceSeatLane,
} from "@langwatch/enterprise-governance-contract";
import {
  type GatewaySpendDay,
  nanoMinorToDecimalString,
  nanoUsdToDecimalString,
} from "@langwatch/gateway-contract";
import type { Instant } from "@langwatch/time";

import type { GovernanceSeatReportRow } from "../repositories/clickhouse/clickhouse.ocsf-events.repository.ts";
import {
  GOVERNANCE_COST_CURRENCY_USD,
  GOVERNANCE_COST_SOURCE,
  type GovernanceCostDayLaneGroup,
} from "../repositories/governance-cost-rollup.repository.ts";

/** How long a pull's touch keeps a day provisional (main `GOVERNANCE_SETTLING_WINDOW_DAYS`). */
export const GOVERNANCE_SETTLING_WINDOW_DAYS = 30;
const DAY_MS = 86_400_000;

export function laneWithoutFigure(): GovernanceCostLane {
  return {
    amountUsd: null,
    cellsWithoutAmount: 0,
    currenciesWithoutUsdAmount: [],
    currencyTotals: [],
  };
}

/** Only pools somebody pays to seat people in reach the screen. */
export function seatsFrom(reports: readonly GovernanceSeatReportRow[]): GovernanceSeatLane {
  const pools = reports
    .filter((pool) => pool.perPerson && pool.live && !pool.free && pool.seatStem)
    .map((pool) => ({
      skuPartNumber: pool.skuPartNumber,
      day: pool.day,
      seatsBought: pool.seatsBought,
      seatsAssigned: pool.seatsAssigned,
    }))
    .toSorted((a, b) => a.skuPartNumber.localeCompare(b.skuPartNumber));
  return pools.length ? { status: "reported", pools } : { status: "awaiting_data" };
}

/** A figure is stated only when no cell behind it lacks an amount; a partial sum is withheld whole. */
type Figure = { kind: "stated"; amount: number } | { kind: "withheld" };
const WITHHELD: Figure = { kind: "withheld" };

function usdFigure({
  totalNanoUsd,
  cellsWithoutAmount,
}: {
  totalNanoUsd: bigint | null;
  cellsWithoutAmount: number;
}): Figure {
  if (cellsWithoutAmount > 0 || totalNanoUsd === null) return WITHHELD;
  return { kind: "stated", amount: Number(nanoUsdToDecimalString(totalNanoUsd)) };
}

function minorFigure({
  totalNanoMinor,
  cellsWithoutAmount,
}: {
  totalNanoMinor: number | null;
  cellsWithoutAmount: number;
}): Figure {
  if (cellsWithoutAmount > 0 || totalNanoMinor === null) return WITHHELD;
  return { kind: "stated", amount: Number(nanoMinorToDecimalString(BigInt(totalNanoMinor))) };
}

/** A day still inside its settling window may yet move; derived from the clock, never stored. */
export function isWithinSettlingWindow({
  lastObservedAtSeconds,
  windowDays,
  now,
}: {
  lastObservedAtSeconds: number;
  windowDays: number;
  now: Instant;
}): boolean {
  if (lastObservedAtSeconds <= 0) return false;
  return now.epochMilliseconds - lastObservedAtSeconds * 1000 < windowDays * DAY_MS;
}

function figureFor(rows: readonly GovernanceCostDayLaneGroup[]): Figure {
  const withoutAmount = rows.reduce((count, row) => count + row.cellsWithoutAmount, 0);
  const priced = rows.flatMap((row) => (row.amountNanoUsd === null ? [] : [row.amountNanoUsd]));
  if (priced.length === 0) return WITHHELD;
  const totalNanoUsd = priced.reduce((sum, amount) => sum + BigInt(amount), 0n);
  return usdFigure({ totalNanoUsd, cellsWithoutAmount: withoutAmount });
}

function previousFigureFor(row: GovernanceCostDayLaneGroup): Figure {
  if (row.revisedAt === null) return WITHHELD;
  return usdFigure({
    totalNanoUsd: row.previousAmountNanoUsd === null ? null : BigInt(row.previousAmountNanoUsd),
    cellsWithoutAmount: row.cellsWithoutPreviousAmount,
  });
}

/** One line per billed currency; no rate is ever applied between two lines (ADR-128 §3). */
export function currencyTotalsFrom(
  rows: readonly {
    currencyCode: string;
    amountNanoMinor: number | null;
    cellsWithoutAmount: number;
  }[],
): GovernanceCostCurrencyTotal[] {
  return rows
    .map((row) => {
      const total = minorFigure({
        totalNanoMinor: row.amountNanoMinor,
        cellsWithoutAmount: row.cellsWithoutAmount,
      });
      return {
        currencyCode: row.currencyCode,
        amount: total.kind === "stated" ? total.amount : null,
        cellsWithoutAmount: row.cellsWithoutAmount,
      };
    })
    .toSorted((a, b) => a.currencyCode.localeCompare(b.currencyCode));
}

function dayCurrencyLinesFrom(row: GovernanceCostDayLaneGroup): GovernanceCostDayCurrencyLine[] {
  const lines =
    row.byCurrency.length === 0
      ? [
          {
            currencyCode: GOVERNANCE_COST_CURRENCY_USD,
            now: figureFor([row]),
            before: previousFigureFor(row),
          },
        ]
      : row.byCurrency.map((line) => ({
          currencyCode: line.currencyCode,
          now: minorFigure({
            totalNanoMinor: line.amountNanoMinor,
            cellsWithoutAmount: line.cellsWithoutAmount,
          }),
          before:
            row.revisedAt === null
              ? WITHHELD
              : minorFigure({
                  totalNanoMinor: line.previousAmountNanoMinor,
                  cellsWithoutAmount: line.cellsWithoutPreviousAmount,
                }),
        }));
  return lines.map(({ currencyCode, now, before }) => ({
    currencyCode,
    amount: now.kind === "stated" ? now.amount : null,
    previousAmount: before.kind === "stated" ? before.amount : null,
  }));
}

/** The metered lane marks rather than withholds: a priced request stands the figure. */
export function gatewayFigureStands(counts: {
  requestCount: number;
  pricedRequestCount: number;
  requestsWithoutAmount: number;
}): boolean {
  if (counts.pricedRequestCount > 0) return true;
  return counts.requestCount > 0 && counts.requestsWithoutAmount === 0;
}

export function gatewayLaneFrom(days: readonly GatewaySpendDay[]): GovernanceCostLane {
  const requestCount = days.reduce((n, day) => n + day.requestCount, 0);
  const pricedRequestCount = days.reduce((n, day) => n + day.pricedRequestCount, 0);
  const requestsWithoutAmount = days.reduce((n, day) => n + day.requestsWithoutAmount, 0);
  const totalNanoUsd = days.reduce((sum, day) => sum + BigInt(day.amountNanoUsd), 0n);
  const amountUsd = gatewayFigureStands({ requestCount, pricedRequestCount, requestsWithoutAmount })
    ? Number(nanoUsdToDecimalString(totalNanoUsd))
    : null;
  return {
    amountUsd,
    cellsWithoutAmount: 0,
    currenciesWithoutUsdAmount: [],
    currencyTotals:
      amountUsd === null
        ? []
        : [
            {
              currencyCode: GOVERNANCE_COST_CURRENCY_USD,
              amount: amountUsd,
              cellsWithoutAmount: 0,
            },
          ],
    requestsWithoutAmount,
  };
}

/** Oldest day first; either lane may hold no figure on a day. */
export function seriesFrom({
  rows,
  gatewayDays,
  now,
}: {
  rows: readonly GovernanceCostDayLaneGroup[];
  gatewayDays: readonly GatewaySpendDay[];
  now: Instant;
}): GovernanceCostDay[] {
  const byDay = new Map<string, GovernanceCostDay>();
  const entryFor = (day: string): GovernanceCostDay => {
    const existing = byDay.get(day);
    if (existing) return existing;
    const fresh: GovernanceCostDay = {
      day,
      billedUsd: null,
      gatewayUsd: null,
      billedCellsWithoutAmount: 0,
      gatewayCellsWithoutAmount: 0,
      billedRevisedAt: null,
      billedByCurrency: [],
      billedCurrenciesWithoutUsdAmount: [],
      billedProvisional: false,
    };
    byDay.set(day, fresh);
    return fresh;
  };
  for (const row of rows) {
    if (row.costSource !== GOVERNANCE_COST_SOURCE.PULLED) continue;
    const entry = entryFor(row.day);
    const billed = figureFor([row]);
    entry.billedUsd = billed.kind === "stated" ? billed.amount : null;
    entry.billedCellsWithoutAmount = row.cellsWithoutAmount;
    entry.billedRevisedAt = row.revisedAt === null ? null : row.revisedAt * 1000;
    entry.billedByCurrency = dayCurrencyLinesFrom(row);
    entry.billedCurrenciesWithoutUsdAmount = row.currenciesWithoutUsdAmount;
    entry.billedProvisional = isWithinSettlingWindow({
      lastObservedAtSeconds: row.lastObservedAt,
      windowDays: GOVERNANCE_SETTLING_WINDOW_DAYS,
      now,
    });
  }
  for (const day of gatewayDays) {
    entryFor(day.day).gatewayUsd = gatewayFigureStands(day)
      ? Number(nanoUsdToDecimalString(BigInt(day.amountNanoUsd)))
      : null;
  }
  return [...byDay.values()].toSorted((a, b) => a.day.localeCompare(b.day));
}
