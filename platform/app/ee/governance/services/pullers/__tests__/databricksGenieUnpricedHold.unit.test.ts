// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * @vitest-environment node
 *
 * A Genie question is never a measured zero.
 *
 * Genie bills nothing per question; the compute behind it is on the
 * warehouse's bill, which lands later and only when the credential can read
 * the billing tables. Two things follow, and both are asserted here through
 * `runOnce` with the transport mocked: a question whose bill has not answered
 * carries no amount at all rather than zero, and a warehouse whose bill cannot
 * be read holds the source's place instead of closing the period at zero.
 *
 * Spec: specs/governance/pulled-usage-cost-reporting.feature
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  DatabricksGeniePuller,
  WAREHOUSE_COST_UNREADABLE,
} from "../databricksGenie.puller";
import { PULLED_USAGE_HINT_KEY } from "../pulledUsageRecord";

vi.mock("~/utils/ssrfProtection", () => ({ ssrfSafeFetch: vi.fn() }));
const { ssrfSafeFetch } = await import("~/utils/ssrfProtection");
const fetchMock = vi.mocked(ssrfSafeFetch);

const WORKSPACE_URL = "https://adb-1.azuredatabricks.net";
const WAREHOUSE_ID = "095eb666b2ed2762";
const STATEMENT_ID = "stmt-abc";
const HOUR_MS = 60 * 60 * 1000;

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

/** The whole hour an instant falls in, as the workspace would report it. */
function usageHourOf(atMs: number): string {
  return new Date(Math.floor(atMs / HOUR_MS) * HOUR_MS).toISOString();
}

type BillingAnswer =
  | { kind: "rows"; rows: (string | null)[][] }
  | { kind: "http"; status: number }
  | { kind: "state"; state: string };

let billing: BillingAnswer;
let messageCreatedMs: number;

/** Every call the adapter made to run a statement, in order. */
function statementCalls(): number {
  return fetchMock.mock.calls.filter(([url]) =>
    String(url).includes("/api/2.0/sql/statements"),
  ).length;
}

beforeEach(() => {
  fetchMock.mockReset();
  billing = { kind: "rows", rows: [] };
  messageCreatedMs = Date.now() - 60_000;

  fetchMock.mockImplementation(async (url: string, init) => {
    const path = String(url).replace(WORKSPACE_URL, "");
    if (path.startsWith("/api/2.0/genie/spaces?")) {
      return reply({ spaces: [{ space_id: "space-1", title: "Revenue" }] });
    }
    if (path.startsWith("/api/2.0/genie/spaces/space-1/conversations?")) {
      return reply({
        conversations: [{ conversation_id: "conv-1", title: "How many?" }],
      });
    }
    if (
      path.startsWith(
        "/api/2.0/genie/spaces/space-1/conversations/conv-1/messages",
      )
    ) {
      return reply({
        messages: [
          {
            message_id: "msg-1",
            content: "How many orders last week?",
            status: "COMPLETED",
            created_timestamp: messageCreatedMs,
            user_id: 42,
            attachments: [
              {
                query: {
                  query: "SELECT count(*) FROM orders",
                  statement_id: STATEMENT_ID,
                  query_result_metadata: { row_count: 1 },
                },
              },
            ],
          },
        ],
      });
    }
    if (path.startsWith("/api/2.0/preview/scim/v2/Users/")) {
      return reply({
        id: "42",
        userName: "u_123@acme.test",
        displayName: "Dana",
        active: true,
      });
    }
    if (path === "/api/2.0/sql/statements" && init?.method === "POST") {
      if (billing.kind === "http") return reply({}, billing.status);
      if (billing.kind === "state") {
        return reply({
          statement_id: "fixture",
          status: { state: billing.state, error: { message: "no grant" } },
        });
      }
      return reply({
        statement_id: "fixture",
        status: { state: "SUCCEEDED" },
        manifest: {
          schema: { columns: WAREHOUSE_COST_COLUMNS.map((name) => ({ name })) },
        },
        result: { data_array: billing.rows },
      });
    }
    return reply({ error: `unrouted ${path}` }, 404);
  });
});

async function pull({
  warehouseId,
  cursor = null,
}: {
  warehouseId?: string;
  cursor?: string | null;
}) {
  return await new DatabricksGeniePuller().runOnce(
    { cursor, credentials: { token: "dapi-fixture" } },
    {
      adapter: "databricks_genie",
      workspaceUrl: WORKSPACE_URL,
      spaceIds: [],
      schedule: "*/15 * * * *",
      readPaidGenieBill: false,
      ...(warehouseId ? { warehouseId } : {}),
    },
  );
}

function hintOf(result: { events: { extra?: Record<string, unknown> }[] }) {
  const extra = result.events[0]?.extra;
  return extra?.[PULLED_USAGE_HINT_KEY] as Record<string, unknown> | undefined;
}

function cursorOf(result: { cursor: string | null }) {
  return JSON.parse(result.cursor!) as {
    sinceMs: number;
    costHeldSinceMs: number | null;
  };
}

describe("given a Genie question whose bill has not answered", () => {
  describe("when the source names no warehouse", () => {
    /** @scenario "A Genie message whose bill has not answered carries no amount" */
    it("records the question with no amount at all, not zero", async () => {
      const result = await pull({});

      expect(result.events).toHaveLength(1);
      expect(result.events[0]?.cost_usd).toBeUndefined();
      // The hint is still there — it is what makes the message a cost item
      // once a bill lands — but it names no amount.
      expect(hintOf(result)).toBeDefined();
      expect(hintOf(result)).not.toHaveProperty("costUsd");
      expect(statementCalls()).toBe(0);
    });
  });

  describe("when the warehouse has not billed the question's hour yet", () => {
    /** @scenario "A Genie message whose bill has not answered carries no amount" */
    it("records the question with no amount and no zero anywhere on it", async () => {
      // Seen in the query history, no billing row yet: a null SKU.
      billing = {
        kind: "rows",
        rows: [
          [
            STATEMENT_ID,
            usageHourOf(messageCreatedMs),
            "1800000",
            "3600000",
            null,
            null,
            null,
          ],
        ],
      };

      const result = await pull({ warehouseId: WAREHOUSE_ID });

      expect(result.events).toHaveLength(1);
      expect(result.events[0]?.cost_usd).toBeUndefined();
      expect(hintOf(result)).toBeDefined();
      expect(hintOf(result)).not.toHaveProperty("costUsd");
      expect(JSON.stringify(result.events[0])).not.toContain('"0"');
    });

    /** @scenario "A Genie message whose bill has not answered carries no amount" */
    it("prices the question on the run the bill lands", async () => {
      billing = { kind: "rows", rows: [] };
      const first = await pull({ warehouseId: WAREHOUSE_ID });
      expect(hintOf(first)).not.toHaveProperty("costUsd");

      billing = {
        kind: "rows",
        rows: [
          [
            STATEMENT_ID,
            usageHourOf(messageCreatedMs),
            "1800000",
            "3600000",
            "6.00",
            "USD",
            "PREMIUM_SERVERLESS_SQL_COMPUTE_EU_WEST",
          ],
        ],
      };
      const second = await pull({
        warehouseId: WAREHOUSE_ID,
        cursor: first.cursor,
      });

      expect(hintOf(second)?.costUsd).toBe("3");
      expect(second.events[0]?.cost_usd).toBe("3");
    });
  });
});

describe("given a warehouse whose bill cannot be read", () => {
  const refusals: { name: string; answer: BillingAnswer }[] = [
    {
      name: "the billing query is refused",
      answer: { kind: "http", status: 403 },
    },
    {
      name: "the warehouse no longer exists",
      answer: { kind: "http", status: 404 },
    },
    {
      name: "the statement itself fails",
      answer: { kind: "state", state: "FAILED" },
    },
  ];

  for (const refusal of refusals) {
    describe(`when ${refusal.name}`, () => {
      /** @scenario "A warehouse that cannot be read holds the day open instead of closing it at zero" */
      it("keeps the questions unpriced and holds its place for the next run", async () => {
        billing = refusal.answer;
        const startedFrom = Date.now() - 3 * 24 * HOUR_MS;

        const result = await pull({
          warehouseId: WAREHOUSE_ID,
          cursor: JSON.stringify({ sinceMs: startedFrom }),
        });

        // Still recorded, still a run that worked.
        expect(result.events).toHaveLength(1);
        expect(result.errorCount).toBe(0);
        expect(result.events[0]?.cost_usd).toBeUndefined();
        expect(hintOf(result)).not.toHaveProperty("costUsd");

        // Held, not closed: the watermark did not move past the period the
        // bill could not answer for, and the hold clock started.
        const cursor = cursorOf(result);
        expect(cursor.sinceMs).toBe(startedFrom);
        expect(cursor.costHeldSinceMs).not.toBeNull();

        // And the run says so, in a form a reader of the source can be shown.
        expect(result.notices).toContain(WAREHOUSE_COST_UNREADABLE);
      });
    });
  }

  describe("when the bill can be read again on a later run", () => {
    /** @scenario "A warehouse that cannot be read holds the day open instead of closing it at zero" */
    it("prices the held question and releases the hold", async () => {
      billing = { kind: "http", status: 404 };
      const first = await pull({
        warehouseId: WAREHOUSE_ID,
        cursor: JSON.stringify({ sinceMs: Date.now() - 3 * 24 * HOUR_MS }),
      });
      expect(cursorOf(first).costHeldSinceMs).not.toBeNull();

      billing = {
        kind: "rows",
        rows: [
          [
            STATEMENT_ID,
            usageHourOf(messageCreatedMs),
            "1800000",
            "3600000",
            "6.00",
            "USD",
            "PREMIUM_SERVERLESS_SQL_COMPUTE_EU_WEST",
          ],
        ],
      };
      const second = await pull({
        warehouseId: WAREHOUSE_ID,
        cursor: first.cursor,
      });

      expect(hintOf(second)?.costUsd).toBe("3");
      expect(cursorOf(second).costHeldSinceMs).toBeNull();
      expect(second.notices ?? []).not.toContain(WAREHOUSE_COST_UNREADABLE);
    });
  });
});
