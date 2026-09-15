// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * @vitest-environment node
 *
 * The paid Genie bill line: Databricks bills paid Genie usage per person and
 * per day on its own line in `system.billing.usage`, with no warehouse behind
 * it, so the warehouse allocation can never see it. This is the separate read
 * that asks for those rows directly — switched on per source, priced from
 * list prices where one is published, and walking on a position of its own.
 *
 * Driven through `runOnce` with the transport mocked. The fixture answers the
 * two statements the adapter can post by what each one asks about: the
 * warehouse allocation names the query history, the bill line names its
 * billing origin.
 *
 * Spec: specs/governance/pulled-usage-cost-reporting.feature
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  DatabricksGeniePullerAdapter,
  databricksGeniePullConfigSchema,
  PAID_GENIE_BILL_UNREADABLE,
} from "../databricks-genie-puller.service.ts";
import { PULLED_USAGE_HINT_KEY } from "@langwatch/enterprise-governance-contract";

vi.mock("~/utils/ssrfProtection", () => ({ ssrfSafeFetch: vi.fn() }));
const { ssrfSafeFetch } = await import("~/utils/ssrfProtection");
const fetchMock = vi.mocked(ssrfSafeFetch);

const WORKSPACE_URL = "https://adb-1.azuredatabricks.net";
const WAREHOUSE_ID = "095eb666b2ed2762";
const PAID_SKU = "PREMIUM_GENIE_SERVERLESS_REAL_TIME_INFERENCE_EU_WEST";
const FREE_SKU = "GENIE_FREE_USAGE";
const HOUR_MS = 60 * 60 * 1000;
const ONE_DAY_MS = 24 * HOUR_MS;
/**
 * The day the fixture bills on: two days back, from the clock. The read's
 * first-run window is the last thirty days through tomorrow and the fixture
 * only serves rows inside the window it was asked about, so a day pinned to
 * the calendar would fall out of the window a month after it was written and
 * every row-landing test would fail with nothing landed.
 */
const DAY = new Date(Date.now() - 2 * ONE_DAY_MS).toISOString().slice(0, 10);
/** Where a first read with no configured start begins: thirty days back, day-aligned. */
const FIRST_RUN_FLOOR_MS =
  Math.floor((Date.now() - 30 * ONE_DAY_MS) / ONE_DAY_MS) * ONE_DAY_MS;
/** The same limit the warehouse read holds for. */
const MAX_HOLD_MS = 7 * ONE_DAY_MS;

const reply = (body: unknown, status = 200) =>
  ({
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "" : "refused",
    json: async () => body,
  }) as unknown as Awaited<ReturnType<typeof ssrfSafeFetch>>;

const WAREHOUSE_COST_COLUMNS = [
  "statement_id",
  "usage_hour",
  "execution_ms_in_hour",
  "hour_total_ms",
  "hour_billable_usd",
  "currency_code",
  "sku_name",
];

const PAID_BILL_COLUMNS = [
  "run_as",
  "usage_date",
  "sku_name",
  "quantity",
  "amount",
  "currency_code",
  "surfaces",
  "channels",
];

type StatementPlan =
  | { kind: "rows"; rows: (string | null)[][]; cutShort?: boolean }
  | { kind: "http"; status: number }
  | { kind: "state"; state: string };

let warehousePlan: StatementPlan;
let billPlan: StatementPlan;
/** Every statement body the adapter posted, in order. */
let statementBodies: Record<string, unknown>[];

function billStatements(): Record<string, unknown>[] {
  return statementBodies.filter((body) =>
    String(body.statement).includes("billing_origin_product"),
  );
}

/**
 * The rows a real reply would carry for the window it was asked about. The
 * bill is read a week at a time and the weeks tile the window half-open on
 * the date, so a day belongs to exactly one of them — a fixture that served
 * every row to every week would land the same day once per week.
 */
function rowsInWindow({
  rows,
  columns,
  body,
}: {
  rows: (string | null)[][];
  columns: string[];
  body: Record<string, unknown>;
}): (string | null)[][] {
  const at = columns.indexOf("usage_date");
  if (at === -1) return rows;
  const parameters = (body.parameters ?? []) as {
    name: string;
    value: string;
  }[];
  const bound = (name: string) =>
    Date.parse(parameters.find((p) => p.name === name)?.value ?? "");
  const fromMs = bound("from_date");
  const toMs = bound("to_date");
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs)) return rows;
  return rows.filter((row) => {
    const dayMs = Date.parse(String(row[at]));
    return !Number.isFinite(dayMs) || (dayMs >= fromMs && dayMs < toMs);
  });
}

function answer(
  plan: StatementPlan,
  columns: string[],
  body: Record<string, unknown>,
) {
  if (plan.kind === "http") return reply({}, plan.status);
  if (plan.kind === "state") {
    return reply({
      statement_id: "fixture",
      status: { state: plan.state, error: { message: "no grant" } },
    });
  }
  return reply({
    statement_id: "fixture",
    status: { state: "SUCCEEDED" },
    manifest: { schema: { columns: columns.map((name) => ({ name })) } },
    result: {
      data_array: rowsInWindow({ rows: plan.rows, columns, body }),
      ...(plan.cutShort ? { next_chunk_index: 1 } : {}),
    },
  });
}

beforeEach(() => {
  fetchMock.mockReset();
  statementBodies = [];
  warehousePlan = { kind: "rows", rows: [] };
  billPlan = { kind: "rows", rows: [] };

  fetchMock.mockImplementation(async (url: string, init) => {
    const path = String(url).replace(WORKSPACE_URL, "");
    if (path.startsWith("/api/2.0/genie/spaces?")) {
      return reply({ spaces: [] });
    }
    if (path === "/api/2.0/sql/statements" && init?.method === "POST") {
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      statementBodies.push(body);
      return String(body.statement).includes("billing_origin_product")
        ? answer(billPlan, PAID_BILL_COLUMNS, body)
        : answer(warehousePlan, WAREHOUSE_COST_COLUMNS, body);
    }
    return reply({ error: `unrouted ${path}` }, 404);
  });
});

async function pull({
  readPaidGenieBill,
  warehouseId = WAREHOUSE_ID,
  cursor = null,
}: {
  readPaidGenieBill?: boolean;
  warehouseId?: string;
  cursor?: string | null;
}) {
  return await new DatabricksGeniePullerAdapter().runOnce(
    { cursor, credentials: { token: "dapi-fixture" } },
    {
      adapter: "databricks_genie",
      workspaceUrl: WORKSPACE_URL,
      spaceIds: [],
      schedule: "*/15 * * * *",
      ...(warehouseId ? { warehouseId } : {}),
      // What the schema's default would have filled in; the config is built
      // by hand here rather than parsed.
      readPaidGenieBill: readPaidGenieBill ?? false,
    },
  );
}

function billEvents(result: Awaited<ReturnType<typeof pull>>) {
  return result.events.filter((event) => event.action === "genie_bill");
}

function hintOf(event: { extra?: Record<string, unknown> }) {
  return event.extra?.[PULLED_USAGE_HINT_KEY] as
    | Record<string, unknown>
    | undefined;
}

function cursorOf(result: { cursor: string | null }) {
  return JSON.parse(result.cursor!) as {
    sinceMs: number;
    costHeldSinceMs: number | null;
    paidBillReadThroughMs: number | null;
    paidBillHeldSinceMs: number | null;
  };
}

/** The bound value of one named parameter on the first bill statement posted. */
function firstBillParameter(name: string): string {
  const asked = billStatements();
  const first = asked[0];
  if (first === undefined) {
    throw new Error("no bill statement was posted");
  }
  return (first.parameters as { name: string; value: string }[]).find(
    (p) => p.name === name,
  )!.value;
}

const paidRow = (
  overrides: Partial<{
    runAs: string;
    day: string;
    sku: string;
    quantity: string;
    amount: string | null;
    currency: string | null;
    surfaces: string;
    channels: string;
  }> = {},
): (string | null)[] => [
  overrides.runAs ?? "u_123@acme.test",
  overrides.day ?? DAY,
  overrides.sku ?? PAID_SKU,
  overrides.quantity ?? "12.5",
  overrides.amount === undefined ? "3.125" : overrides.amount,
  overrides.currency === undefined ? "USD" : overrides.currency,
  overrides.surfaces ?? "GENIE_ONE",
  overrides.channels ?? "",
];

describe("given a Genie source that has not switched the paid bill read on", () => {
  /** @scenario "The paid Genie bill read is off unless switched on" */
  it("reads as off when the setting is absent", () => {
    const parsed = databricksGeniePullConfigSchema.parse({
      adapter: "databricks_genie",
      workspaceUrl: WORKSPACE_URL,
    });
    expect(parsed.readPaidGenieBill).toBe(false);
  });

  /** @scenario "The paid Genie bill read is off unless switched on" */
  it("never asks the workspace for the Genie bill and records no bill row", async () => {
    billPlan = { kind: "rows", rows: [paidRow()] };

    const result = await pull({});

    expect(billStatements()).toHaveLength(0);
    expect(billEvents(result)).toHaveLength(0);
    expect(cursorOf(result).paidBillReadThroughMs).toBeNull();
  });
});

describe("given a Genie source with the paid bill read switched on", () => {
  describe("when the workspace bills a person's usage under a price line with a list price", () => {
    /** @scenario "A paid Genie charge lands on the identity the bill names as run_as, for that day and that price line" */
    it("records one cost row for that person, day and price line at the list price", async () => {
      billPlan = { kind: "rows", rows: [paidRow()] };

      const result = await pull({ readPaidGenieBill: true });
      const events = billEvents(result);

      expect(events).toHaveLength(1);
      const event = events[0]!;
      expect(event.actor).toBe("u_123@acme.test");
      expect(event.event_timestamp).toBe(`${DAY}T00:00:00.000Z`);
      expect(event.cost_usd).toBe("3.125");

      const hint = hintOf(event)!;
      expect(hint.costBasis).toBe("provider_reported");
      expect(hint.costStatus).toBe("estimate");
      expect(hint.costUsd).toBe("3.125");
      expect(hint.model).toBe(PAID_SKU);
      // Never a warehouse as the agent: the bill names no space and no
      // warehouse ran it, so the row carries no agent at all.
      expect(hint).not.toHaveProperty("agentId");
      expect(JSON.stringify(event)).not.toContain(WAREHOUSE_ID);
      // The quantity travels with the row for whoever reads it.
      expect(event.extra?.quantity).toBe("12.5");
    });

    /** @scenario "A paid Genie charge lands on the identity the bill names as run_as, for that day and that price line" */
    it("asks the workspace for the Genie bill line on the configured warehouse", async () => {
      billPlan = { kind: "rows", rows: [] };

      await pull({ readPaidGenieBill: true });

      const asked = billStatements();
      expect(asked.length).toBeGreaterThan(0);
      const body = asked[0]!;
      expect(body.warehouse_id).toBe(WAREHOUSE_ID);
      const sql = String(body.statement);
      expect(sql).toContain("FROM system.billing.usage");
      expect(sql).toContain("billing_origin_product = 'GENIE'");
      expect(sql).toContain("LEFT JOIN system.billing.list_prices");
      expect(sql).toContain("identity_metadata.run_as");
      // A separate read: the warehouse allocation's own filter, which drops
      // every row this read exists for, is nowhere in it.
      expect(sql).not.toContain("warehouse_id IS NOT NULL");
      expect(sql).not.toContain("system.query.history");
    });

    /** @scenario "A paid Genie charge lands on the identity the bill names as run_as, for that day and that price line" */
    it("carries the currency when the only list price is not in dollars", async () => {
      billPlan = {
        kind: "rows",
        rows: [paidRow({ amount: "2.80", currency: "EUR" })],
      };

      const result = await pull({ readPaidGenieBill: true });
      const hint = hintOf(billEvents(result)[0]!)!;

      expect(hint.costUsd).toBe("2.80");
      expect(hint.currency).toBe("EUR");
      // Not a dollar figure, so not in the dollar field.
      expect(billEvents(result)[0]?.cost_usd).toBeUndefined();
    });
  });

  describe("when the workspace reports usage under a price line with no list price", () => {
    /** @scenario "A free Genie row lands with its usage count and no amount" */
    it("records the row with its quantity and no amount", async () => {
      billPlan = {
        kind: "rows",
        rows: [
          paidRow({
            sku: FREE_SKU,
            quantity: "40",
            amount: null,
            currency: null,
          }),
        ],
      };

      const result = await pull({ readPaidGenieBill: true });
      const events = billEvents(result);

      expect(events).toHaveLength(1);
      const event = events[0]!;
      expect(event.extra?.quantity).toBe("40");
      expect(event.cost_usd).toBeUndefined();
      const hint = hintOf(event)!;
      expect(hint).not.toHaveProperty("costUsd");
      expect(hint.model).toBe(FREE_SKU);
      // No zero anywhere on it: no price is not a price of nothing.
      expect(JSON.stringify(event)).not.toContain('"0"');
    });

    const zeroPriced: { name: string; sku: string }[] = [
      { name: "a free row priced at zero", sku: FREE_SKU },
      { name: "a paid price line listed at zero", sku: PAID_SKU },
    ];
    for (const { name, sku } of zeroPriced) {
      /** @scenario "A free Genie row lands with its usage count and no amount" */
      it(`${name} still lands with no amount`, async () => {
        // The day Databricks publishes a list price of zero, the statement's
        // multiplication yields a well-formed decimal zero rather than null.
        billPlan = {
          kind: "rows",
          rows: [
            paidRow({
              sku,
              quantity: "40",
              amount: "0.000000000000",
              currency: "USD",
            }),
          ],
        };

        const result = await pull({ readPaidGenieBill: true });
        const events = billEvents(result);

        expect(events).toHaveLength(1);
        const event = events[0]!;
        expect(event.extra?.quantity).toBe("40");
        expect(event.cost_usd).toBeUndefined();
        expect(event.cost_amount).toBeUndefined();
        expect(hintOf(event)).not.toHaveProperty("costUsd");
        expect(JSON.stringify(event)).not.toContain("0.000000000000");
      });
    }
  });

  describe("when a person's day spans several surfaces and channels", () => {
    /** @scenario "Surface and channel are labels and do not split a person's day" */
    it("asks for one row per person, day and price line, with surface and channel folded in", async () => {
      billPlan = { kind: "rows", rows: [] };

      await pull({ readPaidGenieBill: true });

      const sql = String(billStatements()[0]!.statement);
      const groupBy = sql.match(/GROUP BY\s+([^\n]+)/)?.[1] ?? "";
      expect(groupBy).toBe("1, 2, 3");
      expect(sql).toContain("usage_metadata.genie.surface");
      expect(sql).toContain("usage_metadata.genie.channel");
    });

    /** @scenario "Surface and channel are labels and do not split a person's day" */
    it("keeps surface and channel out of what identifies the row", async () => {
      billPlan = {
        kind: "rows",
        rows: [
          paidRow({
            surfaces: "GENIE_CODE,GENIE_ONE",
            channels: "SLACK,TEAMS",
          }),
        ],
      };

      const result = await pull({ readPaidGenieBill: true });
      const event = billEvents(result)[0]!;
      const hint = hintOf(event)!;

      // Labels, on the row.
      expect(event.extra?.surfaces).toBe("GENIE_CODE,GENIE_ONE");
      expect(event.extra?.channels).toBe("SLACK,TEAMS");
      // Not in the key: the dimensions the restatement key hashes name the
      // person and the price line and nothing else about the usage.
      expect(hint.dimensions).toEqual({
        line: "genie_bill",
        runAs: "u_123@acme.test",
        skuName: PAID_SKU,
      });
      expect(event.source_event_id).not.toContain("GENIE_CODE");
      expect(event.source_event_id).not.toContain("SLACK");
    });
  });

  describe("when the bill answer stops short", () => {
    const stops: { name: string; plan: StatementPlan; reported: boolean }[] = [
      {
        name: "it comes back cut short",
        plan: { kind: "rows", rows: [paidRow()], cutShort: true },
        reported: false,
      },
      {
        name: "it runs out of time",
        plan: { kind: "state", state: "CANCELED" },
        reported: false,
      },
      {
        name: "it is refused",
        plan: { kind: "http", status: 403 },
        reported: true,
      },
      {
        name: "the statement itself fails",
        plan: { kind: "state", state: "FAILED" },
        reported: true,
      },
    ];

    for (const stop of stops) {
      /** @scenario "A paid Genie read that stops short holds its place and lands nothing" */
      it(`lands nothing and holds its own place when ${stop.name}`, async () => {
        billPlan = stop.plan;

        const result = await pull({ readPaidGenieBill: true });

        expect(billEvents(result)).toHaveLength(0);
        expect(result.errorCount).toBe(0);
        const cursor = cursorOf(result);
        // Its own place: a fresh read that could not finish holds at the
        // floor it started from, and writes that floor down.
        expect(cursor.paidBillReadThroughMs).toBe(FIRST_RUN_FLOOR_MS);
        expect(cursor.paidBillHeldSinceMs).not.toBeNull();
        // And the warehouse read's place is untouched by it: that read priced
        // its window whole, so the watermark moved and nothing is held.
        expect(cursor.sinceMs).toBeGreaterThan(Date.now() - HOUR_MS);
        expect(cursor.costHeldSinceMs).toBeNull();
        if (stop.reported) {
          expect(result.notices).toContain(PAID_GENIE_BILL_UNREADABLE);
        } else {
          expect(result.notices ?? []).not.toContain(
            PAID_GENIE_BILL_UNREADABLE,
          );
        }
      });
    }

    /** @scenario "A paid Genie read that stops short holds its place and lands nothing" */
    it("keeps the paid bill's own place moving when the warehouse read is the one held", async () => {
      warehousePlan = { kind: "http", status: 403 };
      billPlan = { kind: "rows", rows: [paidRow()] };

      const result = await pull({ readPaidGenieBill: true });
      const cursor = cursorOf(result);

      expect(billEvents(result)).toHaveLength(1);
      expect(cursor.paidBillReadThroughMs).not.toBeNull();
      expect(cursor.costHeldSinceMs).not.toBeNull();
    });

    /** @scenario "A paid Genie read that stops short holds its place and lands nothing" */
    it("starts the next read from where the last one reached, looking back a little", async () => {
      billPlan = { kind: "rows", rows: [] };
      const first = await pull({ readPaidGenieBill: true });
      const reachedMs = cursorOf(first).paidBillReadThroughMs!;
      expect(reachedMs).toBeGreaterThan(Date.now() - 24 * HOUR_MS);

      statementBodies = [];
      const second = await pull({
        readPaidGenieBill: true,
        cursor: first.cursor,
      });

      const from = firstBillParameter("from_date");
      // Behind where it reached — a day's bill keeps landing after the day —
      // but not back at the start of history.
      expect(Date.parse(from)).toBeLessThanOrEqual(reachedMs);
      expect(Date.parse(from)).toBeGreaterThan(reachedMs - 4 * 24 * HOUR_MS);
      expect(cursorOf(second).paidBillReadThroughMs).toBeGreaterThanOrEqual(
        reachedMs,
      );
    });
  });

  describe("when the bill is refused on every run", () => {
    /** @scenario "A held paid Genie read keeps its floor across runs" */
    it("keeps the floor it first held at instead of sliding it forward", async () => {
      billPlan = { kind: "http", status: 403 };

      const first = await pull({ readPaidGenieBill: true });
      const firstCursor = cursorOf(first);
      expect(firstCursor.paidBillReadThroughMs).toBe(FIRST_RUN_FLOOR_MS);
      const heldSinceMs = firstCursor.paidBillHeldSinceMs!;
      expect(heldSinceMs).not.toBeNull();

      statementBodies = [];
      const second = await pull({
        readPaidGenieBill: true,
        cursor: first.cursor,
      });
      const secondCursor = cursorOf(second);

      // The same floor, and the same hold: neither the position nor the
      // instant the hold began moved with the clock.
      expect(secondCursor.paidBillReadThroughMs).toBe(FIRST_RUN_FLOOR_MS);
      expect(secondCursor.paidBillHeldSinceMs).toBe(heldSinceMs);
      // And the second run asked about the held period again, from at or
      // before the floor — never from a floor that crept forward.
      expect(Date.parse(firstBillParameter("from_date"))).toBeLessThanOrEqual(
        FIRST_RUN_FLOOR_MS,
      );
      expect(billEvents(second)).toHaveLength(0);
      expect(second.notices).toContain(PAID_GENIE_BILL_UNREADABLE);
    });

    /** @scenario "A held paid Genie read keeps its floor across runs" */
    it("still reads a cursor written before the hold had a clock", async () => {
      billPlan = { kind: "http", status: 403 };
      const sinceMs = Date.now() - 3 * ONE_DAY_MS;
      const cursor = JSON.stringify({
        sinceMs,
        spaceId: null,
        conversationId: null,
        sweepHadGap: false,
        spaceSetFingerprint: null,
        sweepOldestPendingMs: null,
        sweepStartedAtMs: null,
        costHeldSinceMs: null,
        paidBillReadThroughMs: FIRST_RUN_FLOOR_MS,
      });

      const result = await pull({ readPaidGenieBill: true, cursor });
      const next = cursorOf(result);

      // Not restarted from the configured watermark: the old cursor parsed,
      // the floor it carried is kept, and the hold starts its clock now.
      expect(next.paidBillReadThroughMs).toBe(FIRST_RUN_FLOOR_MS);
      expect(next.paidBillHeldSinceMs).toBeGreaterThan(Date.now() - HOUR_MS);
      expect(next.sinceMs).toBeGreaterThanOrEqual(sinceMs);
    });

    /** @scenario "A paid Genie hold older than the limit moves on" */
    it("moves past the window once the hold is older than the limit, recording nothing for it", async () => {
      billPlan = { kind: "http", status: 403 };
      const heldSinceMs = Date.now() - MAX_HOLD_MS - ONE_DAY_MS;
      const held = await pull({ readPaidGenieBill: true });
      const cursor = JSON.stringify({
        ...cursorOf(held),
        paidBillHeldSinceMs: heldSinceMs,
      });

      const result = await pull({ readPaidGenieBill: true, cursor });
      const next = cursorOf(result);

      // Moved on: the position is at the end of the window it asked about,
      // and the hold is released so the next one ages from its own start.
      const endOfTodayMs =
        Math.floor(Date.now() / ONE_DAY_MS) * ONE_DAY_MS + ONE_DAY_MS;
      expect(next.paidBillReadThroughMs).toBe(endOfTodayMs);
      expect(next.paidBillHeldSinceMs).toBeNull();
      // Nothing recorded for the span it gave up on — no row, so no zero.
      expect(billEvents(result)).toHaveLength(0);
      expect(JSON.stringify(result.events)).not.toContain("genie_bill");
      // The refusal is still named in the run's result.
      expect(result.notices).toContain(PAID_GENIE_BILL_UNREADABLE);
      // And the warehouse read's hold is not the one that was aged.
      expect(next.costHeldSinceMs).toBeNull();
    });

    /** @scenario "A paid Genie hold older than the limit moves on" */
    it("keeps holding while the hold is younger than the limit", async () => {
      billPlan = { kind: "http", status: 403 };
      const heldSinceMs = Date.now() - MAX_HOLD_MS + ONE_DAY_MS;
      const held = await pull({ readPaidGenieBill: true });
      const cursor = JSON.stringify({
        ...cursorOf(held),
        paidBillHeldSinceMs: heldSinceMs,
      });

      const next = cursorOf(await pull({ readPaidGenieBill: true, cursor }));

      expect(next.paidBillReadThroughMs).toBe(FIRST_RUN_FLOOR_MS);
      expect(next.paidBillHeldSinceMs).toBe(heldSinceMs);
    });

    /** @scenario "A held paid Genie read keeps its floor across runs" */
    it("releases the hold on the run the bill reads whole", async () => {
      billPlan = { kind: "http", status: 403 };
      const held = await pull({ readPaidGenieBill: true });
      expect(cursorOf(held).paidBillHeldSinceMs).not.toBeNull();

      billPlan = { kind: "rows", rows: [paidRow()] };
      const result = await pull({
        readPaidGenieBill: true,
        cursor: held.cursor,
      });
      const next = cursorOf(result);

      expect(billEvents(result)).toHaveLength(1);
      expect(next.paidBillHeldSinceMs).toBeNull();
      expect(next.paidBillReadThroughMs).toBeGreaterThan(FIRST_RUN_FLOOR_MS);
    });
  });

  describe("when the source names no warehouse to run the read on", () => {
    /** @scenario "A paid Genie read that stops short holds its place and lands nothing" */
    it("lands nothing, holds its place and says a warehouse is needed", async () => {
      billPlan = { kind: "rows", rows: [paidRow()] };

      const result = await pull({ readPaidGenieBill: true, warehouseId: "" });

      expect(billStatements()).toHaveLength(0);
      expect(billEvents(result)).toHaveLength(0);
      // No window was asked about, so there is no floor to write and no
      // hold to age: the read starts fresh once a warehouse is named.
      expect(cursorOf(result).paidBillReadThroughMs).toBeNull();
      expect(cursorOf(result).paidBillHeldSinceMs).toBeNull();
      expect(result.notices).toContain(PAID_GENIE_BILL_UNREADABLE);
    });
  });
});
