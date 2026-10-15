import { PULLED_USAGE_HINT_KEY } from "@langwatch/enterprise-governance-contract";
import { describe, expect, it } from "vitest";

import {
  PAID_GENIE_BILL_COLUMNS,
  PAID_GENIE_BILL_STATEMENT,
  type PaidGenieBillRow,
  paidGenieBillEvent,
  paidGenieBillParameters,
  paidGenieBillRows,
  startOfDayMs,
} from "../../features/databricks-genie/rules/databricks-genie-paid-bill.rules.ts";

const usdRow: PaidGenieBillRow = {
  runAs: "alice@example.test",
  usageDate: "2026-01-02",
  skuName: "PREMIUM_GENIE",
  quantity: "3.5",
  amount: "1.75",
  currencyCode: "USD",
  surfaces: "SPACE",
  channels: "WEB",
};

describe("paidGenieBillParameters()", () => {
  it("binds whole UTC days as DATE parameters", () => {
    expect(
      paidGenieBillParameters({ fromMs: Date.UTC(2026, 0, 1), toMs: Date.UTC(2026, 0, 8) }),
    ).toEqual([
      { name: "from_date", value: "2026-01-01", type: "DATE" },
      { name: "to_date", value: "2026-01-08", type: "DATE" },
    ]);
  });
});

describe("the statement", () => {
  it("selects the columns the reader checks, under the row cap", () => {
    expect(PAID_GENIE_BILL_COLUMNS).toEqual([
      "run_as",
      "usage_date",
      "sku_name",
      "quantity",
      "amount",
      "currency_code",
      "surfaces",
      "channels",
    ]);
    expect(PAID_GENIE_BILL_STATEMENT.startsWith("\nWITH genie_day AS (\n")).toBe(true);
    expect(PAID_GENIE_BILL_STATEMENT.endsWith("LIMIT 50000\n")).toBe(true);
  });
});

describe("paidGenieBillRows()", () => {
  it("reads rows, strips a free or zero price to no amount, and counts unreadable rows", () => {
    const read = paidGenieBillRows([
      ["alice@example.test", "2026-01-02", "PREMIUM_GENIE", "3.5", "1.75", "USD", "SPACE", "WEB"],
      [null, "2026-01-02", "GENIE_FREE_USAGE_X", "2", "0.5", "USD", null, null],
      ["bob", "2026-01-02", "SKU_Z", "1", "0.000", "USD", "", ""],
      ["bob", "not-a-date", "SKU_Z", "1", "1", "USD", "", ""],
    ]);

    expect(read.unreadable).toBe(1);
    expect(read.rows).toEqual([
      usdRow,
      {
        runAs: "",
        usageDate: "2026-01-02",
        skuName: "GENIE_FREE_USAGE_X",
        quantity: "2",
        amount: null,
        currencyCode: null,
        surfaces: "",
        channels: "",
      },
      {
        runAs: "bob",
        usageDate: "2026-01-02",
        skuName: "SKU_Z",
        quantity: "1",
        amount: null,
        currencyCode: null,
        surfaces: "",
        channels: "",
      },
    ]);
  });
});

describe("paidGenieBillEvent()", () => {
  it("lands a dollar row as a provider-reported estimate keyed on person, day and price line", () => {
    expect(paidGenieBillEvent(usdRow)).toEqual({
      source_event_id: "genie_bill:2026-01-02:PREMIUM_GENIE:alice@example.test",
      event_timestamp: "2026-01-02T00:00:00.000Z",
      actor: "alice@example.test",
      action: "genie_bill",
      target: "PREMIUM_GENIE",
      cost_usd: "1.75",
      tokens_input: 0,
      tokens_output: 0,
      raw_payload:
        '{"runAs":"alice@example.test","usageDate":"2026-01-02","skuName":"PREMIUM_GENIE",' +
        '"quantity":"3.5","amount":"1.75","currencyCode":"USD","surfaces":"SPACE","channels":"WEB"}',
      extra: {
        runAs: "alice@example.test",
        usageDate: "2026-01-02",
        skuName: "PREMIUM_GENIE",
        quantity: "3.5",
        surfaces: "SPACE",
        channels: "WEB",
        priceCurrency: "USD",
        [PULLED_USAGE_HINT_KEY]: {
          costBasis: "provider_reported",
          costStatus: "estimate",
          costUsd: "1.75",
          dimensions: { line: "genie_bill", runAs: "alice@example.test", skuName: "PREMIUM_GENIE" },
          model: "PREMIUM_GENIE",
        },
      },
    });
  });

  it("carries another currency as an amount and currency, never as dollars", () => {
    const event = paidGenieBillEvent({ ...usdRow, amount: "2", currencyCode: "EUR" });

    expect(event).not.toHaveProperty("cost_usd");
    expect(event).toMatchObject({ cost_amount: "2", cost_currency: "EUR" });
    expect(event.extra?.[PULLED_USAGE_HINT_KEY]).toMatchObject({ costUsd: "2", currency: "EUR" });
    expect(event.extra?.priceCurrency).toBe("EUR");
  });

  it("lands an unpriced row with its quantity and no amount", () => {
    const event = paidGenieBillEvent({ ...usdRow, amount: null, currencyCode: null });

    expect(event).not.toHaveProperty("cost_usd");
    expect(event).not.toHaveProperty("cost_amount");
    expect(event.extra?.[PULLED_USAGE_HINT_KEY]).not.toHaveProperty("costUsd");
    expect(event.extra?.priceCurrency).toBe("");
  });
});

describe("startOfDayMs()", () => {
  it("floors to UTC midnight", () => {
    expect(startOfDayMs(Date.UTC(2026, 0, 2, 15, 30))).toBe(Date.UTC(2026, 0, 2));
  });
});
