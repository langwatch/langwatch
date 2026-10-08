import { PULLED_USAGE_HINT_KEY } from "@langwatch/enterprise-governance-contract";
import type { NormalizedPullEvent } from "@langwatch/enterprise-governance-contract";
import { describe, expect, it } from "vitest";

import {
  WAREHOUSE_COST_COLUMNS,
  WAREHOUSE_COST_ROW_LIMIT,
  WAREHOUSE_COST_STATEMENT,
  type WarehouseCostStatement,
  unpricedFloor,
  warehouseAnswerCutShort,
  warehouseCostObserved,
  warehouseCostParameters,
  warehouseCostRows,
  withWarehouseCost,
} from "../../features/databricks-genie/rules/databricks-genie-warehouse-cost.rules.ts";

const chunk = { fromMs: Date.UTC(2026, 0, 1, 10, 37), toMs: Date.UTC(2026, 0, 1, 12, 5) };

describe("warehouseCostParameters()", () => {
  it("binds whole hours, the straddle look-back and the Genie label", () => {
    expect(warehouseCostParameters(chunk)).toEqual([
      { name: "from_ts", value: "2026-01-01T10:00:00.000Z", type: "TIMESTAMP" },
      { name: "scan_from_ts", value: "2025-12-31T10:00:00.000Z", type: "TIMESTAMP" },
      { name: "to_ts", value: "2026-01-01T13:00:00.000Z", type: "TIMESTAMP" },
      { name: "genie_app", value: "Databricks SQL Genie Space", type: "STRING" },
    ]);
  });
});

describe("warehouseCostObserved()", () => {
  it("logs the hour-aligned window and how wide it was", () => {
    expect(
      warehouseCostObserved({ adapter: "databricks_genie", warehouseId: "w1", chunk }),
    ).toEqual({
      adapter: "databricks_genie",
      warehouseId: "w1",
      askedFrom: "2026-01-01T10:00:00.000Z",
      askedTo: "2026-01-01T13:00:00.000Z",
      askedHours: 3,
    });
  });
});

describe("unpricedFloor()", () => {
  it("holds one millisecond before the unpriced chunk", () => {
    expect(unpricedFloor({ fromMs: 1_000 })).toBe(999);
  });
});

describe("the statement", () => {
  it("selects the columns the reader checks, under the row cap", () => {
    expect(WAREHOUSE_COST_COLUMNS).toEqual([
      "statement_id",
      "usage_hour",
      "execution_ms_in_hour",
      "hour_total_ms",
      "hour_billable_usd",
      "currency_code",
      "sku_name",
    ]);
    expect(WAREHOUSE_COST_ROW_LIMIT).toBe(50_000);
    expect(WAREHOUSE_COST_STATEMENT.startsWith("\nWITH ran AS (\n")).toBe(true);
    expect(WAREHOUSE_COST_STATEMENT.endsWith("LIMIT 50000\n")).toBe(true);
  });
});

describe("warehouseAnswerCutShort()", () => {
  const statement = (extra: Partial<WarehouseCostStatement>): WarehouseCostStatement => ({
    status: { state: "SUCCEEDED" },
    ...extra,
  });

  it("calls an answer short when the manifest counts more rows than arrived", () => {
    expect(
      warehouseAnswerCutShort({
        statement: statement({ manifest: { total_row_count: 3 } }),
        dataLength: 2,
      }),
    ).toBe(true);
  });

  it("calls an answer short when the rest sits in another chunk", () => {
    expect(
      warehouseAnswerCutShort({
        statement: statement({ result: { next_chunk_index: 1 } }),
        dataLength: 1,
      }),
    ).toBe(true);
  });

  it("calls an answer short at the row cap", () => {
    expect(warehouseAnswerCutShort({ statement: statement({}), dataLength: 50_000 })).toBe(true);
  });

  it("takes a whole answer as whole", () => {
    expect(
      warehouseAnswerCutShort({
        statement: statement({ manifest: { total_row_count: 2 } }),
        dataLength: 2,
      }),
    ).toBe(false);
  });
});

describe("warehouseCostRows()", () => {
  it("reads positional rows and counts the ones that will not parse", () => {
    const read = warehouseCostRows([
      ["s1", "2026-01-01 10:00:00", "1000", "4000", "2.5", "USD", "SKU"],
      [null, "2026-01-01 10:00:00", "1000", "4000", "2.5", "USD", "SKU"],
    ]);

    expect(read.unreadable).toBe(1);
    expect(read.rows).toEqual([
      {
        statementId: "s1",
        usageHour: "2026-01-01 10:00:00",
        executionMsInHour: "1000",
        hourTotalMs: "4000",
        hourBillableUsd: "2.5",
        currencyCode: "USD",
        skuName: "SKU",
      },
    ]);
  });
});

describe("withWarehouseCost()", () => {
  const event: NormalizedPullEvent = {
    source_event_id: "m1",
    event_timestamp: "2026-01-01T10:00:00.000Z",
    actor: "ann@example.test",
    action: "genie_query",
    target: "Revenue",
    tokens_input: 0,
    tokens_output: 0,
    raw_payload: "{}",
    extra: {
      statementId: "s1",
      [PULLED_USAGE_HINT_KEY]: { costBasis: "provider_reported", costStatus: "estimate" },
    },
  };
  const watermarkBefore = Date.UTC(2026, 0, 1, 9);
  const watermarkAfter = Date.UTC(2026, 0, 1, 11);

  it("leaves a source with no warehouse alone", () => {
    const events = [event];
    expect(
      withWarehouseCost({ events, costByStatementId: null, costEnabled: false, watermarkMs: 0 }),
    ).toBe(events);
  });

  it("attaches the priced share to the audit row and the hint", () => {
    const priced = new Map([
      ["s1", { costUsd: "0.25", hourTotalExecutionMs: "4000", hourBillableUsd: "2.5" }],
    ]);
    const [out] = withWarehouseCost({
      events: [event],
      costByStatementId: priced,
      costEnabled: true,
      watermarkMs: watermarkBefore,
    });

    expect(out).toEqual({
      ...event,
      cost_usd: "0.25",
      extra: {
        statementId: "s1",
        warehouseHour: { totalExecutionMs: "4000", billableUsd: "2.5" },
        [PULLED_USAGE_HINT_KEY]: {
          costBasis: "provider_reported",
          costStatus: "estimate",
          costUsd: "0.25",
        },
      },
    });
  });

  it("drops the hint from an unpriced re-read and keeps a new question as it is", () => {
    const [reread] = withWarehouseCost({
      events: [event],
      costByStatementId: new Map(),
      costEnabled: true,
      watermarkMs: watermarkAfter,
    });
    const [fresh] = withWarehouseCost({
      events: [event],
      costByStatementId: new Map(),
      costEnabled: true,
      watermarkMs: watermarkBefore,
    });

    expect(reread).toEqual({ ...event, extra: { statementId: "s1" } });
    expect(fresh).toBe(event);
  });
});
