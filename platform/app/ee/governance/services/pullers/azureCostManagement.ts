// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * What a Power Platform environment costs, read from the Azure bill.
 *
 * The transcript table says what was said and never what it cost. The bill for
 * the whole environment lives in Azure Cost Management, on the subscription
 * the environment runs in, and Azure publishes it per day per meter category —
 * never per conversation. So this reads the environment's DAILY bill and
 * carries it alongside the conversations. Nothing here divides that total
 * across conversations: a share worked out from a daily figure would be
 * invention rather than measurement.
 *
 * Pure. No I/O, no clock of its own, no fetch — the caller does the talking
 * and hands the reply here, the same way `databricksWarehouseCost.ts` is pure
 * beside `databricksGenie.puller.ts`. That is what lets every rule below be
 * decided against the real captured reply in a unit test.
 *
 * Three things the real reply (2026-08-30, a live subscription, 44 rows) got
 * wrong about the obvious design, each of which produces a plausible-looking
 * wrong number:
 *
 *  1. `UsageDate` is a Number column holding a PACKED integer — 20260823, not
 *     an ISO date. Read as an epoch it lands in 1970; read as a string it
 *     sorts fine and formats as nonsense.
 *
 *  2. A `Currency` column arrives that nothing asked for, in the MIDDLE of the
 *     row. Every value is therefore read by its column NAME. A reader keyed on
 *     position would take the currency for a meter category and the meter
 *     category for money the day Azure adds another column.
 *
 *  3. Every amount is a JSON float, unlike Databricks whose numerics are
 *     strings. The digits that reached us are all the digits there are, so the
 *     float is turned into its exact decimal string ONCE, here, and everything
 *     downstream is string and bigint. `String(n)` is shortest-round-trip in
 *     JavaScript, so it recovers exactly the value that arrived and no
 *     accuracy is invented.
 *
 * The bill is also LATE and PARTIAL. Today's rows are a running total — the
 * captured reply has today's load balancer at 0.375 against 0.60 on every
 * finished day — so a run that only ever asked about new days would record
 * every day at its partial figure and never correct one. Hence the trailing
 * re-read window.
 */

import { z } from "zod";
import { PULLED_USAGE_HINT_KEY } from "./pulledUsageRecord";
import type { NormalizedPullEvent } from "./pullerAdapter";

/**
 * How many days back each run re-reads, today included.
 *
 * A week. Today is always partial, and a day's figures keep moving for a while
 * after it ends as Azure settles its meters. Seven days buys that settling
 * plus room for a subscription whose billing is behind, and it is paid for in
 * rows rather than requests: it is the same single request either way, and the
 * captured week is 44 rows.
 *
 * The re-read is only useful because a restatement REPLACES rather than adds:
 * the same day and meter produce the same restatement key on every run, so the
 * finished figure lands on the partial one instead of beside it.
 */
export const AZURE_COST_REREAD_DAYS = 7;

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

/**
 * How long a window may be held unpriced before the source moves past it.
 *
 * Elapsed time, not distance, and the same bound `WAREHOUSE_COST_MAX_HOLD_MS`
 * draws for the same reason. Holding is right for a bill that is merely late —
 * a throttled request says nothing about whether the window can ever be read,
 * so recording zero for it would be a confident wrong number nothing later
 * corrects. But a window refused identically on every run would otherwise pin
 * the source forever, paying more each time for an answer that cannot arrive.
 *
 * Giving up costs those days their cost figure, which is what they had before
 * any of this existed. Not giving up costs the source its ability to move.
 */
export const AZURE_COST_MAX_HOLD_MS = 7 * ONE_DAY_MS;

/**
 * How long a source waits between asking Cost Management anything at all.
 *
 * Not a tuning knob. Azure publishes this bill once a day and refuses a caller
 * that asks too often, per subscription, with a quota that does not recover in
 * minutes. A source on a five-minute schedule would ask 288 times a day about
 * a figure that moves once — and a live subscription did exactly that, drawing
 * a flat refusal on every attempt and reading the bill zero times in half an
 * hour. The conversations kept arriving; the cost stayed blank forever.
 *
 * Six hours asks four times a day: enough that a bill published at any hour is
 * picked up the same day, few enough to stay well inside the quota, and short
 * enough that a window held by a refusal is retried dozens of times before the
 * cap above abandons it. Raising this past that cap would abandon every held
 * window before the next ask was ever due, which is why the two are tested
 * against each other rather than separately.
 */
const AZURE_COST_READ_INTERVAL_MS = 6 * 60 * 60 * 1000;

/**
 * Whether this run may ask about the bill at all.
 *
 * A run that has never asked always asks, so a source added just now shows a
 * figure on its first pull rather than hours later. A record of asking that
 * lies in the future — a clock that moved backwards, or a position rewound by
 * hand to re-sweep a period — counts as due: waiting for real time to catch up
 * would jam the source shut for a span nothing here can bound.
 */
export function azureCostReadIsDue({
  nowMs,
  readAtMs,
}: {
  nowMs: number;
  readAtMs: number | null;
}): boolean {
  if (readAtMs === null) return true;
  if (readAtMs > nowMs) return true;
  return nowMs - readAtMs >= AZURE_COST_READ_INTERVAL_MS;
}

/** The Cost Management API version this request shape is written against. */
export const AZURE_COST_API_VERSION = "2025-03-01";

/**
 * The one host Azure Resource Manager is served from.
 *
 * Written once because three things depend on it agreeing with itself: the
 * audience the token is minted for, the address the first page is asked of,
 * and the check that decides whether a next-page link may be followed. Two
 * copies drifting apart would show up as the guard refusing the very link the
 * request's own host served, which reads like a permissions problem and is not
 * one.
 */
export const AZURE_MANAGEMENT_HOST = "management.azure.com";

/**
 * Whether a link is Azure Resource Manager itself and nowhere else.
 *
 * The next-page link arrives inside a reply and is followed carrying the ARM
 * bearer token, so where it points is decided by parsing rather than by
 * comparing text. Written the same way, and for the same reason, as
 * `isDataverseEnvironmentOrigin` guards the other host this source sends a
 * token to.
 *
 * `hostname` rather than `host`: it excludes the port, which is compared
 * separately, and it is already lowercased and punycoded by the parser, so a
 * link differing from ARM's own only in letter case is still ARM. Anything
 * that will not parse is not a URL and is refused with everything else.
 *
 * The port, user and password comparisons are not decoration. A link can name
 * the host ARM answers to and still reach somewhere else on it, or carry
 * credentials in front of a host that does match, which a request would then
 * send along with the bearer. Each of those shapes is held out by its own test
 * through the page walk, so none of the four comparisons can be dropped
 * without a test saying so.
 */
export function isAzureResourceManagerUrl(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== "https:") return false;
  if (url.username !== "" || url.password !== "") return false;
  if (url.port !== "") return false;
  return url.hostname === AZURE_MANAGEMENT_HOST;
}

/**
 * One day's bill for one meter category, as it will be recorded.
 *
 * `costMinor` is the amount in the currency the subscription is BILLED in, and
 * `costUsd` is Microsoft's own conversion of it — a separate number at its own
 * invoice-grade rate, never derived from `costMinor` by anything here. Null
 * when the reply carried no dollar column, which is also the correct answer
 * for a subscription already billed in dollars (ADR-128 §3).
 */
export interface AzureDailyCost {
  /** The calendar day, `YYYY-MM-DD` in UTC. */
  day: string;
  /** Azure's own grouping, e.g. "Load Balancer", "Foundry Models". */
  meterCategory: string;
  /** The billed amount as an exact decimal string. Signed: credits are real. */
  costMinor: string;
  /** Microsoft's own dollar figure as a decimal string, or null. */
  costUsd: string | null;
  /** ISO 4217 code for `costMinor`. */
  currencyCode: string;
}

export interface AzureCostRead {
  days: AzureDailyCost[];
  /**
   * Rows that could not be read. Counted rather than dropped silently: a
   * subscription with no spend and a reply nobody could parse look identical
   * on the record, and only one of them is a problem.
   *
   * Never turned into the run's `errorCount`. See the caller — a cost read
   * that reports errors would cost the run its conversations.
   */
  unreadableRows: number;
  /** The next page, when the reply offers one. */
  nextLink: string | null;
  /**
   * The whole reply was not the shape this reads — an HTTP 200 carrying an
   * error body, or a contract change.
   *
   * Distinct from an empty `days`, and the distinction is the point: taken as
   * "Azure says this window cost nothing" the caller would mark the window
   * priced and move on, reporting a genuinely free week. It is the same
   * confusion `unreadableRows` prevents one level down, at the level the row
   * count cannot see.
   */
  malformed: boolean;
}

/**
 * The reply's envelope.
 *
 * Rows are positional arrays and the columns name what each position holds, so
 * both are needed and neither is optional. Values are `unknown` because a
 * single row mixes numbers and strings and one bad row must not cost the rest
 * of the reply.
 */
export const azureCostQueryResponseSchema = z.object({
  properties: z.object({
    columns: z.array(z.object({ name: z.string() })).default([]),
    rows: z.array(z.array(z.unknown())).default([]),
    nextLink: z.string().nullable().default(null),
  }),
});

/** The currency Azure is assumed to bill in when the reply names none. */
const DEFAULT_CURRENCY_CODE = "USD";

/**
 * A packed `YYYYMMDD` integer as a calendar day.
 *
 * Azure sends the day in a column typed `Number`, holding 20260823. Both the
 * obvious readings are wrong: as an epoch it lands in 1970, and as a string it
 * formats as nonsense. Split by position, then round-tripped through `Date` so
 * a day that does not exist — month 13, the 31st of a 30-day month — is
 * refused rather than silently normalised into a neighbouring day and filed
 * under the wrong bill.
 */
export function azureUsageDateToDay(packed: unknown): string | null {
  const value = typeof packed === "number" ? packed : Number(packed);
  if (!Number.isInteger(value) || value < 1_000_101 || value > 99_991_231) {
    return null;
  }
  const year = Math.floor(value / 10_000);
  const month = Math.floor((value % 10_000) / 100);
  const day = value % 100;
  const at = new Date(Date.UTC(year, month - 1, day));
  if (
    at.getUTCFullYear() !== year ||
    at.getUTCMonth() !== month - 1 ||
    at.getUTCDate() !== day
  ) {
    return null;
  }
  return at.toISOString().slice(0, 10);
}

/**
 * A JSON number as the exact decimal string that arrived.
 *
 * Done exactly once, here, at the only place a float exists. `String(n)` is
 * shortest-round-trip in JavaScript, so it names precisely the value that was
 * received — no accuracy is lost and none is invented. Everything downstream
 * is string and bigint, so the amount never passes through a float again.
 *
 * Exponent notation is fine: `usdToNanoUsd` reads it, which matters because
 * the real reply carries amounts like 4.88476914290735e-06.
 */
function amountToDecimalString(value: unknown): string | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return String(value);
}

/** The UTC calendar day an instant falls in. */
function utcDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * The window one run asks about, as inclusive calendar days.
 *
 * Always ends today, because today's figure is partial and has to keep being
 * corrected. It reaches back `AZURE_COST_REREAD_DAYS` days, or to the day
 * after the last one priced — whichever is EARLIER.
 *
 * `Math.min` on the start is load-bearing, and it is the same rule
 * `costReadFloorMs` draws for the warehouse read: the trailing window may only
 * ever WIDEN the ask. A source whose watermark has fallen further behind —
 * paused, or working through a first sweep — must not be dragged forward to
 * the trailing window, which would skip every day in between and then report
 * a complete read.
 */
export function azureCostReadWindow({
  nowMs,
  pricedThroughDay,
}: {
  nowMs: number;
  /** The last day a previous run priced, or null on a first read. */
  pricedThroughDay: string | null;
}): { fromDay: string; toDay: string } {
  const toDay = utcDay(nowMs);
  const trailingStartMs = nowMs - (AZURE_COST_REREAD_DAYS - 1) * ONE_DAY_MS;

  const pricedThroughMs = pricedThroughDay
    ? Date.parse(`${pricedThroughDay}T00:00:00.000Z`)
    : Number.NaN;
  const resumeMs = Number.isFinite(pricedThroughMs)
    ? pricedThroughMs + ONE_DAY_MS
    : Number.POSITIVE_INFINITY;

  return { fromDay: utcDay(Math.min(trailingStartMs, resumeMs)), toDay };
}

/**
 * The request body for one daily cost read.
 *
 * `totalCostUSD` is asked for from day one alongside `totalCost`, which is the
 * whole of how a non-dollar subscription ever gets a dollar figure: we never
 * invent a rate, so the only dollar number we will state is Microsoft's own
 * (ADR-128 §3).
 *
 * Grouped by meter category because that is the finest grain Azure publishes a
 * daily total at, and it is what tells a reader that the Foundry Models line
 * is the AI spend and the load balancer line is not.
 */
export function azureCostRequestBody({
  fromDay,
  toDay,
}: {
  fromDay: string;
  toDay: string;
}) {
  return {
    type: "ActualCost",
    timeframe: "Custom",
    timePeriod: {
      from: `${fromDay}T00:00:00+00:00`,
      to: `${toDay}T23:59:59+00:00`,
    },
    dataset: {
      granularity: "Daily",
      aggregation: {
        totalCost: { name: "Cost", function: "Sum" },
        totalCostUSD: { name: "CostUSD", function: "Sum" },
      },
      grouping: [{ type: "Dimension", name: "MeterCategory" }],
    },
  } as const;
}

/**
 * One reply, as the days it names.
 *
 * Values are read by COLUMN NAME rather than position — see the module note:
 * an unrequested `Currency` column arrived in the middle of the real reply, so
 * positions are not a contract Azure has offered.
 *
 * A row that cannot be read is counted and stepped over. One malformed row
 * must not cost the whole window, and it must not become the run's error count
 * either: the caller degrades rather than fails, because an error here would
 * discard the conversations the run exists to collect.
 */
export function readAzureCostRows({
  response,
}: {
  response: unknown;
}): AzureCostRead {
  const parsed = azureCostQueryResponseSchema.safeParse(response);
  if (!parsed.success) {
    return { days: [], unreadableRows: 0, nextLink: null, malformed: true };
  }
  const { columns, rows, nextLink } = parsed.data.properties;

  const indexOf = new Map(columns.map((column, at) => [column.name, at]));
  const at = (row: unknown[], name: string): unknown => {
    const position = indexOf.get(name);
    return position === undefined ? undefined : row[position];
  };

  const days: AzureDailyCost[] = [];
  let unreadableRows = 0;

  for (const row of rows) {
    const day = azureUsageDateToDay(at(row, "UsageDate"));
    const costMinor = amountToDecimalString(at(row, "Cost"));
    const meterCategory = at(row, "MeterCategory");

    if (
      day === null ||
      costMinor === null ||
      typeof meterCategory !== "string"
    ) {
      unreadableRows += 1;
      continue;
    }

    const currency = at(row, "Currency");
    days.push({
      day,
      meterCategory,
      costMinor,
      // Null rather than 0 when the column is absent or unreadable: absent is
      // "no dollar figure exists", and 0 would read as free.
      costUsd: amountToDecimalString(at(row, "CostUSD")),
      currencyCode:
        typeof currency === "string" && currency.length === 3
          ? currency.toUpperCase()
          : DEFAULT_CURRENCY_CODE,
    });
  }

  return { days, unreadableRows, nextLink, malformed: false };
}

/** The verb these events carry, so a reader can tell them from a conversation. */
export const AZURE_COST_ACTION = "cost_report" as const;

/**
 * The days a read produced, as the events the run hands back.
 *
 * Exactly one event per day the reply actually named. A day Azure returned no
 * row for produces NOTHING — no event, no zero. This is the sharpest rule in
 * the file: the run re-reads a trailing week, so it is constantly asking about
 * days it has already recorded, and a zero emitted for a day whose bill has
 * not landed is a correction downward over a real figure that the summarizing
 * step would faithfully honour. The absence has to survive as an absence.
 *
 * The identity is the subscription, the day and the meter category — never the
 * money. Two reads of the same day produce the same `source_event_id` and the
 * same `dimensions`, which is what makes the finished figure REPLACE the
 * partial one instead of landing beside it and doubling the day.
 */
export function azureCostEvents({
  days,
  subscriptionId,
}: {
  days: AzureDailyCost[];
  subscriptionId: string;
}): NormalizedPullEvent[] {
  return days.map((day) => {
    // The subscription is deliberately NOT a dimension. `restatementKeyFor`
    // already hashes the ingestion source id, which is what separates two
    // customers reading the same bill — so the subscription adds nothing to
    // the identity and takes something away from it: an admin who corrects a
    // mistyped subscription on an existing source would mint fresh keys for
    // the trailing week, and those days would be ADDED beside the figures
    // they were meant to replace rather than over them.
    const dimensions: Record<string, string> = {
      granularity: "1d",
      meterCategory: day.meterCategory,
    };

    return {
      source_event_id: `azure_cost:${subscriptionId}:${day.day}:${day.meterCategory}`,
      // The business day the spend belongs to, not the instant it was read. A
      // restatement of this day keeps this timestamp unchanged.
      event_timestamp: `${day.day}T00:00:00.000Z`,
      // A subscription bill names no person, and inventing one would attribute
      // shared infrastructure to whoever happened to be configured.
      actor: "",
      action: AZURE_COST_ACTION,
      target: day.meterCategory,
      cost_usd: day.costMinor,
      tokens_input: 0,
      tokens_output: 0,
      raw_payload: JSON.stringify(day),
      extra: {
        subscriptionId,
        meterCategory: day.meterCategory,
        [PULLED_USAGE_HINT_KEY]: {
          costBasis: "provider_reported",
          // The bill IS the invoice — this is Azure's own actual-cost record
          // of what the customer was charged, not a usage report that
          // approximates one.
          costStatus: "exact",
          dimensions,
          costUsd: day.costMinor,
          currency: day.currencyCode,
          // Only when Azure published one. Omitted rather than null so the
          // hint schema's own optionality decides, and never filled from a
          // rate of our own.
          ...(day.costUsd === null ? {} : { costUsdBiller: day.costUsd }),
          model: day.meterCategory,
        },
      },
    };
  });
}

/**
 * Where the cost read stands after a run, for the next run to pick up.
 *
 * Three outcomes, and the difference between the last two is the whole point.
 * A window that was PRICED moves the mark to today. A window that was HELD —
 * throttled, unreachable, refused — moves nothing: being told to retry says
 * nothing about what the window costs, and recording zero for it would be a
 * confident wrong number nothing later corrects. A window held past the cap is
 * GIVEN UP.
 *
 * The hold instant is set once and carried, never refreshed on each failure:
 * refreshing it would put the cap permanently out of reach, so a window that
 * can never be read would pin the source forever while asking about an
 * ever-widening span. Giving up costs those days their cost figure, which is
 * what they had before any of this existed. Not giving up costs the source its
 * ability to move at all, and the conversations matter more than the bill.
 *
 * Every outcome records the instant of the ask, because this is only reached
 * when a run actually asked. That record is what `azureCostReadIsDue` reads,
 * and a run that asked without writing it down would be due again on the very
 * next run — the every-five-minutes loop the interval exists to stop.
 */
export function nextAzureCostCursor({
  nowMs,
  previous,
  outcome,
}: {
  nowMs: number;
  previous: { pricedThroughDay: string | null; heldSinceMs: number | null };
  outcome: "priced" | "held";
}): {
  pricedThroughDay: string | null;
  heldSinceMs: number | null;
  readAtMs: number;
} {
  if (outcome === "priced") {
    return {
      pricedThroughDay: utcDay(nowMs),
      heldSinceMs: null,
      readAtMs: nowMs,
    };
  }

  const heldSinceMs = previous.heldSinceMs ?? nowMs;
  if (nowMs - heldSinceMs <= AZURE_COST_MAX_HOLD_MS) {
    return {
      pricedThroughDay: previous.pricedThroughDay,
      heldSinceMs,
      readAtMs: nowMs,
    };
  }

  // Give up: mark the day BEFORE the trailing window's own start as priced, so
  // the next run asks about the last seven days and the ask stops widening.
  const trailingStartMs = nowMs - (AZURE_COST_REREAD_DAYS - 1) * ONE_DAY_MS;
  return {
    pricedThroughDay: utcDay(trailingStartMs - ONE_DAY_MS),
    heldSinceMs: null,
    readAtMs: nowMs,
  };
}
