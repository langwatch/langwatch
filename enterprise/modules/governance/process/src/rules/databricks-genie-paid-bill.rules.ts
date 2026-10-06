// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/** The Genie puller's paid bill line: the statement, its rows and the events they land as. */

import { PULLED_USAGE_HINT_KEY } from "@langwatch/enterprise-governance-contract";
import type { NormalizedPullEvent } from "@langwatch/enterprise-governance-contract";
import { Temporal } from "@langwatch/time";
import { z } from "zod";

import { WAREHOUSE_COST_ROW_LIMIT } from "./databricks-genie-warehouse-cost.rules.ts";
import { GENIE_FREE_USAGE_SKU_MARKER } from "./warehouse-cost.rules.ts";

/**
 * The paid Genie bill line, per person, per day, per price line.
 *
 * A separate statement from `WAREHOUSE_COST_STATEMENT`, and it has to be: that
 * one filters `usage_metadata.warehouse_id IS NOT NULL` because it prices
 * warehouse hours, and the rows this one reads carry no warehouse id at all.
 * Databricks bills Genie's own metered usage under
 * `billing_origin_product = 'GENIE'`, attributed to `identity_metadata.run_as`
 * — the identity the workload ran as, which is the job or query owner and not
 * necessarily the person who typed the question.
 * `usage_metadata.genie.surface` and `.channel` describe where the usage came
 * from.
 *
 * Grouped by person, day and SKU — and NOT by surface or channel. Those two are
 * how Databricks describes the usage, not what it bills, and the grouping here
 * is what becomes the row's identity downstream: a key cannot be changed once
 * money sits under it, so grouping on a description the provider is free to
 * add values to would mint a fresh row per description. They ride along as
 * labels, folded into a sorted list.
 *
 * Priced from `system.billing.list_prices`, LEFT joined: a SKU with no
 * published price (Genie's free line, `GENIE_FREE_USAGE`) comes back with its
 * quantity and a null amount, and lands that way — no price is not a price of
 * nothing. A SKU published AT zero is caught on the way in by
 * `withoutZeroPrice`, so it lands the same way rather than as a measured
 * zero. The price picked is the one in force during the day, dollars
 * preferred, latest start first; a price that changes part-way through a day
 * is applied to the whole day, which is the resolution the bill itself has.
 *
 * Dates are bound as DATE parameters rather than cast from timestamps, because
 * a cast goes through the session time zone and a UTC-midnight instant would
 * name the previous day in a workspace set west of Greenwich.
 */
export const PAID_GENIE_BILL_STATEMENT = `
WITH genie_day AS (
  SELECT
    COALESCE(identity_metadata.run_as, '') AS run_as,
    usage_date,
    sku_name,
    SUM(usage_quantity) AS quantity,
    concat_ws(',', sort_array(collect_set(usage_metadata.genie.surface))) AS surfaces,
    concat_ws(',', sort_array(collect_set(usage_metadata.genie.channel))) AS channels
  FROM system.billing.usage
  WHERE billing_origin_product = 'GENIE'
    AND usage_date >= :from_date
    AND usage_date < :to_date
  GROUP BY 1, 2, 3
),
priced AS (
  SELECT run_as, usage_date, sku_name, quantity, surfaces, channels, currency_code, amount
  FROM (
    SELECT
      d.run_as,
      d.usage_date,
      d.sku_name,
      d.quantity,
      d.surfaces,
      d.channels,
      p.currency_code,
      CAST(d.quantity * p.pricing.effective_list.default AS DECIMAL(38, 12)) AS amount,
      ROW_NUMBER() OVER (
        PARTITION BY d.run_as, d.usage_date, d.sku_name
        ORDER BY CASE WHEN p.currency_code = 'USD' THEN 0 ELSE 1 END,
                 p.price_start_time DESC
      ) AS pick
    FROM genie_day d
    LEFT JOIN system.billing.list_prices p
      ON p.sku_name = d.sku_name
     AND p.price_start_time < CAST(date_add(d.usage_date, 1) AS TIMESTAMP)
     AND (p.price_end_time IS NULL OR p.price_end_time > CAST(d.usage_date AS TIMESTAMP))
  )
  WHERE pick = 1
)
SELECT
  run_as,
  CAST(usage_date AS STRING) AS usage_date,
  sku_name,
  CAST(quantity AS STRING)  AS quantity,
  CAST(amount AS STRING)    AS amount,
  currency_code,
  surfaces,
  channels
FROM priced
LIMIT ${WAREHOUSE_COST_ROW_LIMIT}
`;

/**
 * The columns `PAID_GENIE_BILL_STATEMENT` selects, in order. Checked against
 * the manifest for the same reason `WAREHOUSE_COST_COLUMNS` is: rows are
 * positional strings, and a reordered SELECT would file the quantity as the
 * amount without failing any parse.
 */
export const PAID_GENIE_BILL_COLUMNS = [
  "run_as",
  "usage_date",
  "sku_name",
  "quantity",
  "amount",
  "currency_code",
  "surfaces",
  "channels",
] as const;

/** A decimal as the Statement Execution API renders one: digits, no float. */
const DECIMAL_STRING = /^-?\d+(\.\d+)?$/;

/**
 * One row of the paid bill: a person, a day, a price line, how much, and —
 * when a list price exists — what that is worth.
 */
const paidGenieBillRowSchema = z.object({
  /** Who ran the usage, as Databricks names them. Empty when it names nobody. */
  runAs: z.string(),
  usageDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  skuName: z.string().min(1),
  quantity: z.string().regex(DECIMAL_STRING),
  /** Null when no list price is published for the SKU on that day. */
  amount: z.string().regex(DECIMAL_STRING).nullable(),
  currencyCode: z.string().nullable(),
  surfaces: z.string(),
  channels: z.string(),
});
export type PaidGenieBillRow = z.infer<typeof paidGenieBillRowSchema>;

/**
 * Whole days, both ends, as DATE parameters. The window arrives hour-aligned
 * from `warehouseCostChunks`; a day-aligned window in gives day boundaries
 * out, and the statement filters on `usage_date` half-open so consecutive
 * chunks never both carry the same day.
 */
export function paidGenieBillParameters(chunk: {
  fromMs: number;
  toMs: number;
}): { name: string; value: string; type: string }[] {
  return [
    {
      name: "from_date",
      value: Temporal.Instant.fromEpochMilliseconds(chunk.fromMs).toString().slice(0, 10),
      type: "DATE",
    },
    {
      name: "to_date",
      value: Temporal.Instant.fromEpochMilliseconds(chunk.toMs).toString().slice(0, 10),
      type: "DATE",
    },
  ];
}

/**
 * What one bill reply turned out to be worth. The same four answers as
 * `WarehouseCostRead`, for the same reasons, with rows instead of shares.
 */
export type PaidGenieBillRead =
  | { outcome: "priced"; rows: PaidGenieBillRow[] }
  | { outcome: "cut_short" }
  | { outcome: "timed_out" }
  | { outcome: "failed" };

/**
 * What one run of the paid bill read leaves behind for the cursor.
 *
 * `window` is null when no window was asked about at all — the read is off,
 * or on with no warehouse to run it on — so there is nothing to hold and no
 * hold to age. Otherwise `readThroughMs` is where the read's position lands:
 * the window's end when it finished, the start of the stopped piece when it
 * was `held`. `endMs` is where the position lands INSTEAD once a hold has
 * been aged out by `nextCursor`; carrying it here keeps that decision in the
 * one place that has the clock and the previous cursor.
 */
export type PaidGenieBillOutcome = {
  events: NormalizedPullEvent[];
  window: { readThroughMs: number; endMs: number; held: boolean } | null;
  unreadable: boolean;
};

/**
 * Where a bill walk stopped short: the chunk or piece it could not read, and
 * whether that was a refusal rather than a period too large or too slow.
 */
export type PaidGenieBillStop = {
  heldAt: { fromMs: number; toMs: number };
  unreadable: boolean;
};

/** One bill reply's rows, parsed; `unreadable` counts the rows that would not parse. */
export function paidGenieBillRows(data: (string | null)[][]): {
  rows: PaidGenieBillRow[];
  unreadable: number;
} {
  let unreadable = 0;
  const rows = data.flatMap((columns) => {
    const parsed = paidGenieBillRowSchema.safeParse({
      runAs: columns[0] ?? "",
      usageDate: columns[1],
      skuName: columns[2],
      quantity: columns[3],
      amount: columns[4] ?? null,
      currencyCode: columns[5] ?? null,
      surfaces: columns[6] ?? "",
      channels: columns[7] ?? "",
    });
    if (!parsed.success) {
      unreadable += 1;
      return [];
    }
    return [withoutZeroPrice(parsed.data)];
  });
  return { rows, unreadable };
}

/**
 * A row priced at nothing lands with no amount, not with a zero.
 *
 * The statement's LEFT JOIN gives Genie's free line a null amount because no
 * list price exists for it — today. The day Databricks publishes that line at
 * zero, `quantity * 0` comes back as a well-formed decimal, passes the parse,
 * and lands as a measured zero dollars for usage nobody was billed for. The
 * same holds for any SKU listed at zero: a price of nothing is not a bill,
 * and the ledger reads a zero as one. So the free line (matched on the same
 * marker the warehouse allocation uses) and any zero amount are stripped to
 * quantity-only rows, which the record seam declines to price.
 */
function withoutZeroPrice(row: PaidGenieBillRow): PaidGenieBillRow {
  const free =
    row.skuName.includes(GENIE_FREE_USAGE_SKU_MARKER) ||
    (row.amount !== null && Number(row.amount) === 0);
  return free ? { ...row, amount: null, currencyCode: null } : row;
}

/**
 * One bill row as the event the ledger and the audit sink read.
 *
 * The identity the bill names in `run_as` is the actor — the owner the
 * workload ran as, not necessarily whoever asked the question, and the only
 * person Databricks puts on the charge. The price line is the model; there
 * is no agent, because the bill names no space and no warehouse ran it — a
 * warehouse id here would put compute on the agents screen as if it were a
 * thing people talk to. The day is the event's timestamp, so the record seam
 * buckets it under that day, and `dimensions` carries the person and the
 * price line and nothing else: surface and channel are labels on the row and
 * no part of its key. The rollup keys on TenantId, Day, CostSource, source,
 * Provider, Model, AgentId, CurrencyCode and RawActorId, and `Model` here is
 * the SKU where the warehouse allocation's is `databricks/genie`, so a bill
 * row and a warehouse row for the same person and day never share a cell.
 *
 * An amount only where a list price produced one. A row with none carries its
 * quantity and no `costUsd`, which the record seam declines to price — an
 * unpriced row, never a zero one.
 */
export function paidGenieBillEvent(row: PaidGenieBillRow): NormalizedPullEvent {
  const currency = row.currencyCode ?? "USD";
  let money: {
    cost_usd?: string;
    cost_amount?: string;
    cost_currency?: string;
  } = {};
  let hintMoney: { costUsd?: string; currency?: string } = {};
  if (row.amount !== null) {
    if (currency === "USD") {
      money = { cost_usd: row.amount };
    } else {
      money = { cost_amount: row.amount, cost_currency: currency };
      hintMoney = { costUsd: row.amount, currency };
    }
    if (currency === "USD") hintMoney = { costUsd: row.amount };
  }

  return {
    source_event_id: `${PAID_GENIE_BILL_LINE}:${row.usageDate}:${row.skuName}:${row.runAs}`,
    event_timestamp: `${row.usageDate}T00:00:00.000Z`,
    actor: row.runAs,
    action: PAID_GENIE_BILL_LINE,
    target: row.skuName,
    ...money,
    tokens_input: 0,
    tokens_output: 0,
    raw_payload: JSON.stringify(row),
    extra: {
      runAs: row.runAs,
      usageDate: row.usageDate,
      skuName: row.skuName,
      quantity: row.quantity,
      surfaces: row.surfaces,
      channels: row.channels,
      priceCurrency: row.currencyCode ?? "",
      [PULLED_USAGE_HINT_KEY]: {
        costBasis: "provider_reported",
        // A list price, not the account's negotiated rate — an estimate by
        // construction, for the same reason the warehouse share is one.
        costStatus: "estimate",
        ...hintMoney,
        dimensions: {
          line: PAID_GENIE_BILL_LINE,
          runAs: row.runAs,
          skuName: row.skuName,
        },
        model: row.skuName,
      },
    },
  };
}

export const ONE_DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The line a paid Genie bill row lands under, in the restatement key.
 *
 * A constant coordinate in `dimensions`, so a bill row can never share a key
 * with anything else this adapter emits for the same person and day — and so
 * the key says what it is, for whoever reads it back.
 */
const PAID_GENIE_BILL_LINE = "genie_bill" as const;

/**
 * How far behind its own position the paid bill read starts each run.
 *
 * The bill is published per DAY, and a day's row keeps growing until the day
 * is over and the billing tables have caught up. A read that reached the end
 * of today therefore re-reads today and yesterday next time, so the row lands
 * whole; re-emitting a day REPLACES its ledger row rather than adding one, so
 * the re-read costs one request and never a double count. Two days covers the
 * day boundary plus the documented lag of the billing tables with room to
 * spare.
 */
export const PAID_GENIE_BILL_SETTLING_LAG_MS = 2 * ONE_DAY_MS;

export function startOfDayMs(ms: number): number {
  return Math.floor(ms / ONE_DAY_MS) * ONE_DAY_MS;
}
