// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * The arithmetic that turns a warehouse's hourly bill into a per-question cost.
 *
 * This is the part of the Databricks cost path that cannot be checked against
 * the live workspace, because the answer depends on numbers no fixture and no
 * real workspace agrees on twice. So it is checked here, exactly: a share of an
 * hourly bill, in bigint nanoUSD, never a float.
 *
 * The SQL that produces these rows is validated separately against a real
 * workspace. What is validated here is that a correct result set cannot be
 * turned into a wrong number.
 */

import { describe, expect, it } from "vitest";

import {
  DatabricksWarehouseCostService,
  GENIE_FREE_USAGE_SKU_MARKER,
  WAREHOUSE_COST_CHUNK_MS,
  WAREHOUSE_COST_SETTLING_LAG_MS,
  type WarehousePricedStatement,
} from "../src/services/puller-databricks-warehouse-cost.service";

const warehouseCosts = DatabricksWarehouseCostService.create();

/** One billable hour: $6.00 across 3600s of warehouse time. */
const BILLABLE_SKU = "PREMIUM_SERVERLESS_SQL_COMPUTE_EU_WEST";

/**
 * The hour a row belongs to. Most rows here name one hour; the straddling
 * cases name two, which is the whole point of them.
 */
const HOUR_09 = "2026-08-01T09:00:00.000Z";
const HOUR_10 = "2026-08-01T10:00:00.000Z";

function row({
  statementId,
  executionMsInHour,
  hourTotalMs,
  usageHour = HOUR_09,
  hourBillableUsd = "6.00",
  currencyCode = "USD",
  skuName = BILLABLE_SKU,
}: {
  statementId: string;
  /**
   * The part of the statement's execution that fell inside THIS row's hour,
   * not its whole runtime — a statement that ran through a boundary is
   * several rows, one per hour it was awake in.
   */
  executionMsInHour: string;
  hourTotalMs: string;
  usageHour?: string;
  hourBillableUsd?: string | null;
  currencyCode?: string | null;
  skuName?: string | null;
}) {
  return {
    statementId,
    executionMsInHour,
    usageHour,
    hourTotalMs,
    hourBillableUsd,
    currencyCode,
    skuName,
  };
}

describe("allocateWarehouseCost", () => {
  /** @scenario "The compute behind a question is charged to the person who asked" */
  it("charges a question that used the warehouse", () => {
    const { costByStatementId } = warehouseCosts.allocate({
      rows: [
        row({
          statementId: "stmt-1",
          executionMsInHour: "3600000",
          hourTotalMs: "3600000",
        }),
      ],
    });

    // The only query in the hour, so the whole hour's bill.
    expect(costByStatementId.get("stmt-1")?.costUsd).toBe("6");
  });

  /** @scenario "An hour's compute is split across the questions that used it" */
  it("splits an hour across the questions that used it, in proportion", () => {
    const { costByStatementId } = warehouseCosts.allocate({
      rows: [
        row({
          statementId: "long",
          executionMsInHour: "2000",
          hourTotalMs: "3000",
        }),
        row({
          statementId: "short",
          executionMsInHour: "1000",
          hourTotalMs: "3000",
        }),
      ],
    });

    expect(costByStatementId.get("long")?.costUsd).toBe("4");
    expect(costByStatementId.get("short")?.costUsd).toBe("2");
    // And together no more than the hour that was actually billed.
    expect(
      Number(costByStatementId.get("long")?.costUsd) +
        Number(costByStatementId.get("short")?.costUsd),
    ).toBeLessThanOrEqual(6);
  });

  /** @scenario "Other traffic on the warehouse keeps its share of the bill" */
  it("leaves the rest of the warehouse's traffic its share", () => {
    // Half the hour went to queries no question asked for: the denominator is
    // the whole hour, not the sum of the questions.
    const { costByStatementId } = warehouseCosts.allocate({
      rows: [
        row({
          statementId: "genie-1",
          executionMsInHour: "900000",
          hourTotalMs: "3600000",
        }),
        row({
          statementId: "genie-2",
          executionMsInHour: "900000",
          hourTotalMs: "3600000",
        }),
      ],
    });

    const total =
      Number(costByStatementId.get("genie-1")?.costUsd) +
      Number(costByStatementId.get("genie-2")?.costUsd);
    expect(total).toBeCloseTo(3, 9);
    expect(total).toBeLessThanOrEqual(3);
  });

  /** @scenario "A fraction of a cent survives the record" */
  it("keeps a sub-cent share instead of rounding it away", () => {
    const { costByStatementId } = warehouseCosts.allocate({
      rows: [
        row({
          statementId: "tiny",
          executionMsInHour: "1",
          hourTotalMs: "3600000",
        }),
      ],
    });

    // 6 USD * 1/3_600_000 = 0.000001666… USD. Rounded to a cent this is zero,
    // and a busy workspace of these would report nothing at all.
    const allocated = costByStatementId.get("tiny")?.costUsd;
    expect(allocated).toBe("0.000001666");
    expect(Number(allocated)).toBeGreaterThan(0);
  });

  /** @scenario "Compute the workspace prices in another currency is not converted" */
  it("records nothing for compute priced in another currency, and says why", () => {
    const { costByStatementId, skipped } = warehouseCosts.allocate({
      rows: [
        row({
          statementId: "eur",
          executionMsInHour: "1000",
          hourTotalMs: "1000",
          currencyCode: "EUR",
        }),
      ],
    });

    expect(costByStatementId.has("eur")).toBe(false);
    expect(skipped).toHaveLength(1);
    expect(skipped[0]?.reason).toBe("currency_not_usd");
    expect(skipped[0]?.currencyCode).toBe("EUR");
  });

  /** @scenario "Compute the workspace has no published price for is not guessed" */
  it("records nothing for compute with no published price", () => {
    const { costByStatementId, skipped, owed } = warehouseCosts.allocate({
      rows: [
        row({
          statementId: "unpriced",
          executionMsInHour: "1000",
          hourTotalMs: "1000",
          hourBillableUsd: null,
          currencyCode: null,
        }),
      ],
    });

    expect(costByStatementId.has("unpriced")).toBe(false);
    expect(skipped[0]?.reason).toBe("no_published_price");
    expect(skipped[0]?.skuName).toBe(BILLABLE_SKU);
    // A published billing row with no USD rate is a permanent gap, not a bill
    // still on its way. It is skipped, never held.
    expect(owed.has("unpriced")).toBe(false);
  });

  /** @scenario "A question seen before its bill has landed is held, not zeroed" */
  it("holds a question whose hour has no billing row yet", () => {
    // The LEFT JOIN in the cost query keeps the statement and returns a null
    // SKU when `system.billing.usage` has nothing for its hour. That is a bill
    // in flight, not a free question — so it is owed, never priced and never
    // skipped, and the caller holds the watermark for it.
    const { costByStatementId, skipped, owed } = warehouseCosts.allocate({
      rows: [
        row({
          statementId: "unbilled",
          executionMsInHour: "1000",
          hourTotalMs: "1000",
          hourBillableUsd: null,
          currencyCode: null,
          skuName: null,
        }),
      ],
    });

    expect(owed.has("unbilled")).toBe(true);
    expect(costByStatementId.has("unbilled")).toBe(false);
    expect(skipped).toHaveLength(0);
  });

  /** @scenario "A statement that priced on any line is not held for an unbilled one" */
  it("prices a statement even when one of its lines has not been billed yet", () => {
    const { costByStatementId, owed } = warehouseCosts.allocate({
      rows: [
        row({
          statementId: "stmt-1",
          executionMsInHour: "3600000",
          hourTotalMs: "3600000",
          hourBillableUsd: "6.00",
          skuName: BILLABLE_SKU,
        }),
        // A second line for the same statement that has not been billed yet.
        // The priced line wins: the statement has a cost, so it is not owed.
        row({
          statementId: "stmt-1",
          executionMsInHour: "3600000",
          hourTotalMs: "3600000",
          hourBillableUsd: null,
          currencyCode: null,
          skuName: null,
        }),
      ],
    });

    expect(costByStatementId.get("stmt-1")?.costUsd).toBe("6");
    expect(owed.has("stmt-1")).toBe(false);
  });

  /** @scenario "Traffic that began before the hour keeps its share of the bill" */
  it("leaves a straddling statement its share of the hour it ran into", () => {
    // The case a start-hour denominator got wrong. A forty-minute statement
    // begins at 09:58; a one-second question is the only thing to START in
    // hour 10. Sliced by the hours it RAN in, the straddler is 38 of hour 10's
    // 38-and-a-bit minutes, so the question pays for its second and nothing
    // more. Bucketed by start hour, hour 10's denominator held only that
    // second and the question carried the entire hour.
    const { costByStatementId } = warehouseCosts.allocate({
      rows: [
        // Two of its forty minutes fell in hour 09, which was otherwise idle.
        row({
          statementId: "straddler",
          usageHour: HOUR_09,
          executionMsInHour: "120000",
          hourTotalMs: "120000",
        }),
        // The other thirty-eight landed in hour 10, beside the question.
        row({
          statementId: "straddler",
          usageHour: HOUR_10,
          executionMsInHour: "2280000",
          hourTotalMs: "2281000",
        }),
        row({
          statementId: "question",
          usageHour: HOUR_10,
          executionMsInHour: "1000",
          hourTotalMs: "2281000",
        }),
      ],
    });

    // 6 USD * 1000 / 2_281_000 — a quarter of a cent, not six dollars.
    expect(costByStatementId.get("question")?.costUsd).toBe("0.002630425");
    // And the compute it did not do stays with the statement that did it:
    // 6 * 120000/120000 + 6 * 2280000/2281000.
    expect(costByStatementId.get("straddler")?.costUsd).toBe("11.997369574");

    // The ingredients have to name every hour the share was drawn from. Costing
    // a statement out of two hours and then reporting the first hour's total
    // as the denominator makes the record read as a twentyfold error, and the
    // record is what anyone reconciling the bill actually reads.
    expect(costByStatementId.get("straddler")?.hourTotalExecutionMs).toBe("2401000");
    expect(costByStatementId.get("straddler")?.hourBillableUsd).toBe("12");
  });

  /** @scenario "A statement is held when an hour it ran through has no bill yet" */
  it("holds a statement whose later hour has not been billed yet", () => {
    // A statement that ran through the boundary is priced by two hours, and the
    // later one is the one still in flight. Reading "priced at all" as settled
    // moves the watermark past the unbilled hour, and the part of this
    // statement that ran in it is recorded at nothing for good.
    const { costByStatementId, owed } = warehouseCosts.allocate({
      rows: [
        row({
          statementId: "straddler",
          usageHour: HOUR_09,
          executionMsInHour: "120000",
          hourTotalMs: "3600000",
        }),
        row({
          statementId: "straddler",
          usageHour: HOUR_10,
          executionMsInHour: "2280000",
          hourTotalMs: "2281000",
          hourBillableUsd: null,
          currencyCode: null,
          skuName: null,
        }),
      ],
    });

    expect(owed.has("straddler")).toBe(true);
    // Held, not discarded: what did price stays on the record, and the re-read
    // that lands the missing hour restates it.
    expect(costByStatementId.get("straddler")?.costUsd).toBe("0.2");
  });

  /** @scenario "An hour a statement did no work in cannot hold it" */
  it("does not hold a statement for an hour it did no work in", () => {
    // A statement ending exactly on the hour touches the next hour without
    // working in it. If that hour is the one after the warehouse shut down, no
    // bill for it will ever arrive — and reading a null SKU as "not billed
    // yet" would hold the whole source here until the seven-day hold expires.
    // Every hourly scheduled query lands on a boundary, so this is not a
    // corner: it is a weekly stall waiting for one to end at :00.
    const { costByStatementId, owed, skipped } = warehouseCosts.allocate({
      rows: [
        row({
          statementId: "on-the-hour",
          usageHour: HOUR_09,
          executionMsInHour: "1800000",
          hourTotalMs: "3600000",
        }),
        row({
          statementId: "on-the-hour",
          usageHour: HOUR_10,
          executionMsInHour: "0",
          hourTotalMs: "0",
          hourBillableUsd: null,
          currencyCode: null,
          skuName: null,
        }),
      ],
    });

    expect(owed.has("on-the-hour")).toBe(false);
    expect(costByStatementId.get("on-the-hour")?.costUsd).toBe("3");
    // Nor is it a gap worth reporting. Nothing was lost, so naming it as a
    // skip would put a permanent hole in a record that has none.
    expect(skipped).toHaveLength(0);
    // And the hour it did not work in stays out of the ingredients, which are
    // what anyone reconciling this figure divides by.
    expect(costByStatementId.get("on-the-hour")?.hourTotalExecutionMs).toBe("3600000");
    expect(costByStatementId.get("on-the-hour")?.hourBillableUsd).toBe("6");
  });

  /** @scenario "Genie's own free usage is never charged" */
  it("charges nothing for Genie's own free-usage line", () => {
    const { costByStatementId } = warehouseCosts.allocate({
      rows: [
        row({
          statementId: "free",
          executionMsInHour: "1000",
          hourTotalMs: "1000",
          skuName: `${GENIE_FREE_USAGE_SKU_MARKER}_SOMETHING`,
          hourBillableUsd: "99.00",
        }),
      ],
    });

    expect(costByStatementId.has("free")).toBe(false);
  });

  it("refuses an hour that reports no execution time at all", () => {
    // Guard rather than behaviour: dividing by it would be an exception on a
    // path whose whole job is to not lose the visibility records. The share is
    // nonzero on purpose — an hour that totals less than one statement ran in
    // it is the contradiction this branch is for, and a zero share would be
    // caught earlier as an hour the statement did no work in.
    const { costByStatementId, skipped } = warehouseCosts.allocate({
      rows: [
        row({
          statementId: "zero-hour",
          executionMsInHour: "1000",
          hourTotalMs: "0",
        }),
      ],
    });

    expect(costByStatementId.has("zero-hour")).toBe(false);
    expect(skipped[0]?.reason).toBe("hour_has_no_execution_time");
  });

  it("sums a statement that the warehouse billed under two SKUs in one hour", () => {
    // Serverless SQL bills more than one line for the same hour. Two rows for
    // one statement are two parts of its cost, not two competing answers.
    const { costByStatementId } = warehouseCosts.allocate({
      rows: [
        row({
          statementId: "stmt-1",
          executionMsInHour: "3600000",
          hourTotalMs: "3600000",
          hourBillableUsd: "4.00",
          skuName: BILLABLE_SKU,
        }),
        row({
          statementId: "stmt-1",
          executionMsInHour: "3600000",
          hourTotalMs: "3600000",
          hourBillableUsd: "2.00",
          skuName: "PREMIUM_SERVERLESS_SQL_COMPUTE_SURCHARGE",
        }),
      ],
    });

    expect(costByStatementId.get("stmt-1")?.costUsd).toBe("6");
  });
});

describe("costReadFloorMs", () => {
  const nowMs = Date.parse("2026-08-01T12:00:00.000Z");
  const sinceMs = nowMs - 5 * 60 * 1000;

  /** @scenario "A source that prices its questions keeps looking back far enough" */
  it("looks back past the billing delay when the source prices its questions", () => {
    const floor = warehouseCosts.costReadFloor({
      sinceMs,
      nowMs,
      costEnabled: true,
    });

    // Far enough back that a question's compute has had time to be published.
    expect(floor).toBe(nowMs - WAREHOUSE_COST_SETTLING_LAG_MS);
    expect(floor).toBeLessThan(sinceMs);
  });

  /** @scenario "A source that prices nothing does not widen its window" */
  it("reads only what is new when the source prices nothing", () => {
    expect(warehouseCosts.costReadFloor({ sinceMs, nowMs, costEnabled: false })).toBe(
      sinceMs,
    );
  });

  it("never reads less than the watermark already guarantees", () => {
    // A watermark that has fallen behind the settling window (a paused source,
    // a long backfill) must not be dragged FORWARD by the cost look-back —
    // that would skip everything between the two and call the sweep complete.
    const staleSince = nowMs - 30 * 24 * 60 * 60 * 1000;
    expect(
      warehouseCosts.costReadFloor({
        sinceMs: staleSince,
        nowMs,
        costEnabled: true,
      }),
    ).toBe(staleSince);
  });

  it("looks back further than the billing tables are documented to lag", () => {
    // Databricks publishes a query's compute well after the query. If this
    // window is tighter than that delay, every question sits at zero forever
    // and nothing anywhere reports a problem.
    expect(WAREHOUSE_COST_SETTLING_LAG_MS).toBeGreaterThanOrEqual(60 * 60 * 1000);
  });
});

describe("splitting the window into readable pieces", () => {
  const ONE_HOUR = 60 * 60 * 1000;
  /** An exact hour boundary, so the arithmetic is readable in the assertions. */
  const HOUR_START = Math.floor(Date.UTC(2026, 7, 1, 9, 0, 0) / ONE_HOUR) * ONE_HOUR;

  it("covers the whole window with no gap and no overlap", () => {
    // The gap is the part that would be silent: an hour falling between two
    // pieces is an hour nothing asks about, and its questions would price at
    // nothing with every signal saying the read succeeded.
    const fromMs = HOUR_START;
    const toMs = HOUR_START + 30 * 24 * ONE_HOUR;

    const chunks = warehouseCosts.chunks({ fromMs, toMs });

    expect(chunks[0]!.fromMs).toBe(fromMs);
    expect(chunks.at(-1)!.toMs).toBe(toMs);
    for (let i = 1; i < chunks.length; i += 1) {
      expect(chunks[i]!.fromMs).toBe(chunks[i - 1]!.toMs);
    }
  });

  it("orders the pieces oldest first", () => {
    // Load-bearing. The caller stops at the first piece it cannot price and
    // holds the watermark there, which only describes what was read if the
    // unpriced remainder is a suffix.
    const chunks = warehouseCosts.chunks({
      fromMs: HOUR_START,
      toMs: HOUR_START + 5 * 24 * ONE_HOUR,
    });

    for (let i = 1; i < chunks.length; i += 1) {
      expect(chunks[i]!.fromMs).toBeGreaterThan(chunks[i - 1]!.fromMs);
    }
  });

  it("never splits an hour across two pieces", () => {
    // The bill is published per hour. A boundary inside an hour would weigh
    // that hour's queries against a bill the other piece is holding, and price
    // every one of them at nothing.
    const chunks = warehouseCosts.chunks({
      fromMs: HOUR_START + 37 * 60 * 1000,
      toMs: HOUR_START + 3 * 24 * ONE_HOUR + 12 * 60 * 1000,
    });

    for (const chunk of chunks) {
      expect(chunk.fromMs % ONE_HOUR).toBe(0);
      expect(chunk.toMs % ONE_HOUR).toBe(0);
    }
    // Rounded OUT at both ends, so nothing at the edges is left unasked about.
    expect(chunks[0]!.fromMs).toBeLessThanOrEqual(HOUR_START + 37 * 60 * 1000);
    expect(chunks.at(-1)!.toMs).toBeGreaterThanOrEqual(
      HOUR_START + 3 * 24 * ONE_HOUR + 12 * 60 * 1000,
    );
  });

  it("asks about a first sweep in few enough questions to finish a run", () => {
    // The split is bounded from both ends. One question over thirty days has a
    // single row cap to trip, and tripping it leaves the entire month unpriced;
    // thirty questions cost about the same few seconds EACH, whatever period
    // they cover, and thirty of them do not fit in the time a run is given —
    // so the sweep never finished and no day was ever priced.
    const chunks = warehouseCosts.chunks({
      fromMs: HOUR_START,
      toMs: HOUR_START + 30 * 24 * ONE_HOUR,
    });

    expect(chunks.length).toBeLessThanOrEqual(5);
    expect(WAREHOUSE_COST_CHUNK_MS).toBe(7 * 24 * ONE_HOUR);
  });

  it("offers a refused period back as days", () => {
    // What the size above trades away: a chunk big enough to be answered in one
    // question is also big enough to hold more statements than one reply can
    // carry. Days are what the caller re-asks with, so the periods it can still
    // price are priced instead of the whole chunk being surrendered.
    const pieces = warehouseCosts.pieces({
      fromMs: HOUR_START,
      toMs: HOUR_START + 7 * 24 * ONE_HOUR,
    });

    expect(pieces).toHaveLength(7);
    expect(pieces[0]!.fromMs).toBe(HOUR_START);
    expect(pieces.at(-1)!.toMs).toBe(HOUR_START + 7 * 24 * ONE_HOUR);
    for (let i = 1; i < pieces.length; i += 1) {
      expect(pieces[i]!.fromMs).toBe(pieces[i - 1]!.toMs);
    }
  });

  it("offers nothing back for a period already as small as it is asked", () => {
    // The caller stops when there is nothing smaller to ask, and this is what
    // tells it so. Handing back the same period would re-ask an identical
    // question, get an identical refusal, and spend a request each time.
    expect(
      warehouseCosts.pieces({
        fromMs: HOUR_START,
        toMs: HOUR_START + 24 * ONE_HOUR,
      }),
    ).toEqual([]);
    expect(
      warehouseCosts.pieces({
        fromMs: HOUR_START,
        toMs: HOUR_START + ONE_HOUR,
      }),
    ).toEqual([]);
  });

  it("asks nothing about an empty or backwards window", () => {
    expect(warehouseCosts.chunks({ fromMs: HOUR_START, toMs: HOUR_START })).toEqual([]);
    expect(
      warehouseCosts.chunks({
        fromMs: HOUR_START,
        toMs: HOUR_START - ONE_HOUR,
      }),
    ).toEqual([]);
    // A clock or a stored watermark that arrived unreadable. Returning nothing
    // prices nothing, where looping on NaN would hang the run.
    expect(warehouseCosts.chunks({ fromMs: NaN, toMs: HOUR_START })).toEqual([]);
  });
});

describe("mergeWarehouseCost", () => {
  /** @scenario "A query that outlives one billing read is charged in full" */
  it("adds a straddler's two chunks together instead of replacing one with the other", () => {
    // The window is read oldest-first in chunks, and a statement that begins
    // near the end of one burns compute in the next. Each chunk prices the
    // hours it owns, so the same statement comes back twice with a different
    // part of itself — and the sweep emits its question exactly once, with
    // whatever this map holds. Replacing would ship the later chunk's slice as
    // if it were the whole cost.
    const total = new Map<string, WarehousePricedStatement>();

    warehouseCosts.merge({
      into: total,
      from: new Map([
        [
          "straddler",
          {
            costUsd: "0.25",
            hourTotalExecutionMs: "1800000",
            hourBillableUsd: "6",
          },
        ],
      ]),
    });
    warehouseCosts.merge({
      into: total,
      from: new Map([
        [
          "straddler",
          {
            costUsd: "1.75",
            hourTotalExecutionMs: "3600000",
            hourBillableUsd: "12",
          },
        ],
      ]),
    });

    // Exact strings, both halves. The ingredients are sums over the hours the
    // statement ran through, so they add across chunks for the same reason the
    // cost does.
    expect(total.get("straddler")).toEqual({
      costUsd: "2",
      hourTotalExecutionMs: "5400000",
      hourBillableUsd: "18",
    });
  });

  /** @scenario "A query that outlives one billing read is charged in full" */
  it("leaves a statement only one chunk answered for exactly as it arrived", () => {
    const total = new Map<string, WarehousePricedStatement>();
    const priced: WarehousePricedStatement = {
      costUsd: "0.002630425",
      hourTotalExecutionMs: "2401000",
      hourBillableUsd: "12",
    };

    warehouseCosts.merge({
      into: total,
      from: new Map([["question", priced]]),
    });

    expect(total.get("question")).toEqual(priced);
  });
});
