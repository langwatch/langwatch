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
  allocateWarehouseCost,
  costReadFloorMs,
  GENIE_FREE_USAGE_SKU_MARKER,
  WAREHOUSE_COST_CHUNK_MS,
  WAREHOUSE_COST_SETTLING_LAG_MS,
  warehouseCostChunks,
} from "../databricksWarehouseCost";

/** One billable hour: $6.00 across 3600s of warehouse time. */
const BILLABLE_SKU = "PREMIUM_SERVERLESS_SQL_COMPUTE_EU_WEST";

function row({
  statementId,
  executionDurationMs,
  hourTotalMs,
  hourBillableUsd = "6.00",
  currencyCode = "USD",
  skuName = BILLABLE_SKU,
}: {
  statementId: string;
  executionDurationMs: string;
  hourTotalMs: string;
  hourBillableUsd?: string | null;
  currencyCode?: string | null;
  skuName?: string;
}) {
  return {
    statementId,
    executionDurationMs,
    hourTotalMs,
    hourBillableUsd,
    currencyCode,
    skuName,
  };
}

describe("allocateWarehouseCost", () => {
  /** @scenario "The compute behind a question is charged to the person who asked" */
  it("charges a question that used the warehouse", () => {
    const { costByStatementId } = allocateWarehouseCost({
      rows: [
        row({
          statementId: "stmt-1",
          executionDurationMs: "3600000",
          hourTotalMs: "3600000",
        }),
      ],
    });

    // The only query in the hour, so the whole hour's bill.
    expect(costByStatementId.get("stmt-1")).toBe("6");
  });

  /** @scenario "An hour's compute is split across the questions that used it" */
  it("splits an hour across the questions that used it, in proportion", () => {
    const { costByStatementId } = allocateWarehouseCost({
      rows: [
        row({
          statementId: "long",
          executionDurationMs: "2000",
          hourTotalMs: "3000",
        }),
        row({
          statementId: "short",
          executionDurationMs: "1000",
          hourTotalMs: "3000",
        }),
      ],
    });

    expect(costByStatementId.get("long")).toBe("4");
    expect(costByStatementId.get("short")).toBe("2");
    // And together no more than the hour that was actually billed.
    expect(
      Number(costByStatementId.get("long")) +
        Number(costByStatementId.get("short")),
    ).toBeLessThanOrEqual(6);
  });

  /** @scenario "Other traffic on the warehouse keeps its share of the bill" */
  it("leaves the rest of the warehouse's traffic its share", () => {
    // Half the hour went to queries no question asked for: the denominator is
    // the whole hour, not the sum of the questions.
    const { costByStatementId } = allocateWarehouseCost({
      rows: [
        row({
          statementId: "genie-1",
          executionDurationMs: "900000",
          hourTotalMs: "3600000",
        }),
        row({
          statementId: "genie-2",
          executionDurationMs: "900000",
          hourTotalMs: "3600000",
        }),
      ],
    });

    const total =
      Number(costByStatementId.get("genie-1")) +
      Number(costByStatementId.get("genie-2"));
    expect(total).toBeCloseTo(3, 9);
    expect(total).toBeLessThanOrEqual(3);
  });

  /** @scenario "A fraction of a cent survives the record" */
  it("keeps a sub-cent share instead of rounding it away", () => {
    const { costByStatementId } = allocateWarehouseCost({
      rows: [
        row({
          statementId: "tiny",
          executionDurationMs: "1",
          hourTotalMs: "3600000",
        }),
      ],
    });

    // 6 USD * 1/3_600_000 = 0.000001666… USD. Rounded to a cent this is zero,
    // and a busy workspace of these would report nothing at all.
    const allocated = costByStatementId.get("tiny");
    expect(allocated).toBe("0.000001666");
    expect(Number(allocated)).toBeGreaterThan(0);
  });

  /** @scenario "Compute the workspace prices in another currency is not converted" */
  it("records nothing for compute priced in another currency, and says why", () => {
    const { costByStatementId, skipped } = allocateWarehouseCost({
      rows: [
        row({
          statementId: "eur",
          executionDurationMs: "1000",
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
    const { costByStatementId, skipped } = allocateWarehouseCost({
      rows: [
        row({
          statementId: "unpriced",
          executionDurationMs: "1000",
          hourTotalMs: "1000",
          hourBillableUsd: null,
          currencyCode: null,
        }),
      ],
    });

    expect(costByStatementId.has("unpriced")).toBe(false);
    expect(skipped[0]?.reason).toBe("no_published_price");
    expect(skipped[0]?.skuName).toBe(BILLABLE_SKU);
  });

  /** @scenario "Genie's own free usage is never charged" */
  it("charges nothing for Genie's own free-usage line", () => {
    const { costByStatementId } = allocateWarehouseCost({
      rows: [
        row({
          statementId: "free",
          executionDurationMs: "1000",
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
    // path whose whole job is to not lose the visibility records.
    const { costByStatementId, skipped } = allocateWarehouseCost({
      rows: [
        row({
          statementId: "zero-hour",
          executionDurationMs: "0",
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
    const { costByStatementId } = allocateWarehouseCost({
      rows: [
        row({
          statementId: "stmt-1",
          executionDurationMs: "3600000",
          hourTotalMs: "3600000",
          hourBillableUsd: "4.00",
          skuName: BILLABLE_SKU,
        }),
        row({
          statementId: "stmt-1",
          executionDurationMs: "3600000",
          hourTotalMs: "3600000",
          hourBillableUsd: "2.00",
          skuName: "PREMIUM_SERVERLESS_SQL_COMPUTE_SURCHARGE",
        }),
      ],
    });

    expect(costByStatementId.get("stmt-1")).toBe("6");
  });
});

describe("costReadFloorMs", () => {
  const nowMs = Date.parse("2026-08-01T12:00:00.000Z");
  const sinceMs = nowMs - 5 * 60 * 1000;

  /** @scenario "A source that prices its questions keeps looking back far enough" */
  it("looks back past the billing delay when the source prices its questions", () => {
    const floor = costReadFloorMs({ sinceMs, nowMs, costEnabled: true });

    // Far enough back that a question's compute has had time to be published.
    expect(floor).toBe(nowMs - WAREHOUSE_COST_SETTLING_LAG_MS);
    expect(floor).toBeLessThan(sinceMs);
  });

  /** @scenario "A source that prices nothing does not widen its window" */
  it("reads only what is new when the source prices nothing", () => {
    expect(costReadFloorMs({ sinceMs, nowMs, costEnabled: false })).toBe(
      sinceMs,
    );
  });

  it("never reads less than the watermark already guarantees", () => {
    // A watermark that has fallen behind the settling window (a paused source,
    // a long backfill) must not be dragged FORWARD by the cost look-back —
    // that would skip everything between the two and call the sweep complete.
    const staleSince = nowMs - 30 * 24 * 60 * 60 * 1000;
    expect(
      costReadFloorMs({ sinceMs: staleSince, nowMs, costEnabled: true }),
    ).toBe(staleSince);
  });

  it("looks back further than the billing tables are documented to lag", () => {
    // Databricks publishes a query's compute well after the query. If this
    // window is tighter than that delay, every question sits at zero forever
    // and nothing anywhere reports a problem.
    expect(WAREHOUSE_COST_SETTLING_LAG_MS).toBeGreaterThanOrEqual(
      60 * 60 * 1000,
    );
  });
});

describe("splitting the window into readable pieces", () => {
  const ONE_HOUR = 60 * 60 * 1000;
  /** An exact hour boundary, so the arithmetic is readable in the assertions. */
  const HOUR_START =
    Math.floor(Date.UTC(2026, 7, 1, 9, 0, 0) / ONE_HOUR) * ONE_HOUR;

  it("covers the whole window with no gap and no overlap", () => {
    // The gap is the part that would be silent: an hour falling between two
    // pieces is an hour nothing asks about, and its questions would price at
    // nothing with every signal saying the read succeeded.
    const fromMs = HOUR_START;
    const toMs = HOUR_START + 30 * 24 * ONE_HOUR;

    const chunks = warehouseCostChunks({ fromMs, toMs });

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
    const chunks = warehouseCostChunks({
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
    const chunks = warehouseCostChunks({
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

  it("asks about a first sweep in about thirty pieces, not one", () => {
    // The whole point of the split: one question over thirty days has a single
    // row cap to trip, and tripping it leaves the entire month unpriced.
    const chunks = warehouseCostChunks({
      fromMs: HOUR_START,
      toMs: HOUR_START + 30 * 24 * ONE_HOUR,
    });

    expect(chunks).toHaveLength(30);
    expect(WAREHOUSE_COST_CHUNK_MS).toBe(24 * ONE_HOUR);
  });

  it("asks nothing about an empty or backwards window", () => {
    expect(
      warehouseCostChunks({ fromMs: HOUR_START, toMs: HOUR_START }),
    ).toEqual([]);
    expect(
      warehouseCostChunks({ fromMs: HOUR_START, toMs: HOUR_START - ONE_HOUR }),
    ).toEqual([]);
    // A clock or a stored watermark that arrived unreadable. Returning nothing
    // prices nothing, where looping on NaN would hang the run.
    expect(warehouseCostChunks({ fromMs: NaN, toMs: HOUR_START })).toEqual([]);
  });
});
