// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * @vitest-environment node
 *
 * The Genie adapter's cost path, driven through `runOnce` against a fixture
 * workspace.
 *
 * The arithmetic has its own file. What is asserted here is the wiring around
 * it: that naming a warehouse is what asks for billing at all, that a question
 * whose statement is priced carries that price out of the adapter, and — the
 * one that would otherwise be silent — that a source which prices its questions
 * keeps reading them long enough for the price to exist.
 *
 * No database. The adapter's output is a list of events, and every claim here is
 * about that list, so the ledger is somebody else's test.
 */

import { vi } from "vitest";

// `ssrfProtection` builds its validator once at module load from these, and the
// fixture workspace is on loopback. Hoisted for the same reason the sibling
// integration test hoists it: a `beforeAll` runs long after that evaluation.
vi.hoisted(() => {
  process.env.IS_SAAS = "false";
  process.env.BLOCK_LOCAL_HTTP_CALLS = "false";
});

import http from "http";
import type { AddressInfo } from "net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  DATABRICKS_GENIE_ADAPTER_ID,
  DatabricksGeniePuller,
  WAREHOUSE_COST_ROW_LIMIT,
} from "../databricksGenie.puller";
import { WAREHOUSE_COST_SETTLING_LAG_MS } from "../databricksWarehouseCost";
import { PULLED_USAGE_HINT_KEY } from "../pulledUsageRecord";

const SPACE_ID = "space-1";
const CONVERSATION_ID = "conv-1";
const MESSAGE_ID = "msg-1";
const STATEMENT_ID = "stmt-abc";
const WAREHOUSE_ID = "095eb666b2ed2762";

type CostPlan = {
  status?: number;
  state?: string;
  rows?: (string | null)[][];
  columns?: string[];
};

let server: http.Server;
let baseUrl: string;
/** Bodies the fixture was asked to run a statement with, in order. */
let statementBodies: Record<string, unknown>[];
let costPlan: CostPlan | null;
/** Message creation time, moved by tests that care about the read window. */
let messageCreatedMs: number;
/** Whether Genie ran a query to answer the question. */
let messageRanSql: boolean;

beforeEach(async () => {
  statementBodies = [];
  costPlan = null;
  messageCreatedMs = Date.now() - 60_000;
  messageRanSql = true;

  server = http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    res.setHeader("content-type", "application/json");
    res.statusCode = 200;
    const send = (body: unknown) => res.end(JSON.stringify(body));

    if (url.pathname === "/api/2.0/genie/spaces") {
      return send({ spaces: [{ space_id: SPACE_ID, title: "Revenue" }] });
    }
    if (url.pathname === `/api/2.0/genie/spaces/${SPACE_ID}/conversations`) {
      return send({
        conversations: [
          { conversation_id: CONVERSATION_ID, title: "How many?" },
        ],
      });
    }
    if (
      url.pathname ===
      `/api/2.0/genie/spaces/${SPACE_ID}/conversations/${CONVERSATION_ID}/messages`
    ) {
      return send({
        messages: [
          {
            message_id: MESSAGE_ID,
            content: "How many orders last week?",
            status: "COMPLETED",
            created_timestamp: messageCreatedMs,
            user_id: 42,
            attachments: messageRanSql
              ? [
                  {
                    query: {
                      query: "SELECT count(*) FROM orders",
                      statement_id: STATEMENT_ID,
                      query_result_metadata: { row_count: 1 },
                    },
                  },
                ]
              : [{ text: { content: "I need a bit more detail." } }],
          },
        ],
      });
    }
    if (url.pathname.startsWith("/api/2.0/preview/scim/v2/Users/")) {
      return send({
        id: "42",
        userName: "dana@acme.test",
        displayName: "Dana Hoffman",
        active: true,
      });
    }
    if (url.pathname === "/api/2.0/sql/statements" && req.method === "POST") {
      let raw = "";
      req.on("data", (chunk) => (raw += chunk));
      req.on("end", () => {
        statementBodies.push(
          JSON.parse(raw || "{}") as Record<string, unknown>,
        );
        if (costPlan?.status) {
          res.statusCode = costPlan.status;
          return send({ message: "permission denied" });
        }
        send({
          statement_id: "fixture",
          status: { state: costPlan?.state ?? "SUCCEEDED" },
          manifest: {
            schema: {
              columns: (
                costPlan?.columns ?? [
                  "statement_id",
                  "execution_duration_ms",
                  "hour_total_ms",
                  "hour_billable_usd",
                  "currency_code",
                  "sku_name",
                ]
              ).map((name) => ({ name })),
            },
          },
          result: { data_array: costPlan?.rows ?? [] },
        });
      });
      return;
    }

    res.statusCode = 404;
    send({ error: `unrouted ${url.pathname}` });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterEach(async () => {
  await new Promise<void>((resolve) => {
    server.close(() => resolve());
  });
});

async function pull({ warehouseId }: { warehouseId?: string }) {
  const puller = new DatabricksGeniePuller();
  return await puller.runOnce(
    { cursor: null, credentials: { token: "dapi-fixture" } },
    {
      adapter: DATABRICKS_GENIE_ADAPTER_ID,
      workspaceUrl: baseUrl,
      spaceIds: [],
      schedule: "*/15 * * * *",
      ...(warehouseId ? { warehouseId } : {}),
    },
  );
}

/** The `pulled_usage` hint on the one message the fixture serves. */
function hintOf(result: { events: { extra?: Record<string, unknown> }[] }) {
  const extra = result.events[0]?.extra;
  return (extra?.[PULLED_USAGE_HINT_KEY] ?? {}) as Record<string, unknown>;
}

describe("a source with no warehouse", () => {
  /** @scenario "A question costs nothing when no warehouse is named" */
  it("records the question at zero and never asks about billing", async () => {
    const result = await pull({});

    expect(result.events).toHaveLength(1);
    expect(result.events[0]?.cost_usd).toBe(0);
    expect(hintOf(result).costUsd).toBe("0");
    // The claim that matters: not merely that cost is zero, but that a source
    // which opted out never went near the billing tables.
    expect(statementBodies).toHaveLength(0);
  });
});

describe("a source that names a warehouse", () => {
  /** @scenario "The compute behind a question is charged to the person who asked" */
  it("carries the question's share of the warehouse bill", async () => {
    costPlan = {
      rows: [
        [
          STATEMENT_ID,
          "1800000",
          "3600000",
          "6.00",
          "USD",
          "PREMIUM_SERVERLESS_SQL_COMPUTE_EU_WEST",
        ],
      ],
    };

    const result = await pull({ warehouseId: WAREHOUSE_ID });

    // Half the hour's execution time, so half its $6 bill.
    expect(hintOf(result).costUsd).toBe("3");
    expect(result.events[0]?.cost_usd).toBe(3);
    // Still an estimate: the figure is a share worked out from list prices.
    expect(hintOf(result).costStatus).toBe("estimate");
    // And still attributed to the person who asked.
    expect(result.events[0]?.actor).toBe("dana@acme.test");
  });

  /** @scenario "The billing query only ever runs on the configured workspace" */
  it("asks the configured warehouse, with the id bound rather than pasted in", async () => {
    costPlan = { rows: [] };

    await pull({ warehouseId: WAREHOUSE_ID });

    expect(statementBodies).toHaveLength(1);
    const body = statementBodies[0]!;
    expect(body.warehouse_id).toBe(WAREHOUSE_ID);
    // Bound as a parameter. Interpolating it into the statement would make the
    // statement a function of stored configuration.
    expect(body.parameters).toEqual(
      expect.arrayContaining([
        { name: "warehouse_id", value: WAREHOUSE_ID, type: "STRING" },
      ]),
    );
    expect(String(body.statement)).not.toContain(WAREHOUSE_ID);
  });

  /** @scenario "A billing outage never rewrites a cost that was already worked out" */
  it("does not price a re-read question it could not get a cost for", async () => {
    // The message is older than the watermark, so this run is reading it ONLY
    // to attach cost — it was already recorded, and may already carry a cost
    // from a run when billing was answering.
    messageCreatedMs = Date.now() - 60 * 60 * 1000;
    costPlan = { status: 403 };

    const puller = new DatabricksGeniePuller();
    const result = await puller.runOnce(
      {
        cursor: JSON.stringify({
          sinceMs: Date.now() - 10 * 60 * 1000,
          spaceId: null,
          conversationId: null,
          sweepHadGap: false,
          spaceSetFingerprint: null,
          sweepStartedAtMs: null,
          sweepOldestPendingMs: null,
        }),
        credentials: { token: "dapi-fixture" },
      },
      {
        adapter: DATABRICKS_GENIE_ADAPTER_ID,
        workspaceUrl: baseUrl,
        spaceIds: [],
        schedule: "*/15 * * * *",
        warehouseId: WAREHOUSE_ID,
      },
    );

    // Still recorded for visibility.
    expect(result.events).toHaveLength(1);
    // But carrying NO usage hint, so the ledger is not asked to write anything.
    // Emitting a zero here would overwrite a correct cost with nothing, and a
    // billing outage would quietly wipe the spend it could not confirm.
    expect(result.events[0]?.extra?.[PULLED_USAGE_HINT_KEY]).toBeUndefined();
  });

  /** @scenario "Billing answered in a shape we did not ask for is not priced from" */
  it("refuses to price when the answer's columns are not the ones asked for", async () => {
    // The duration and the hour's total swapped. Every value is still a string
    // and every one still parses, so nothing downstream can notice — but the
    // question now claims 3600000/900000 of a $6 hour, which is $24: four times
    // an hour that was never billed at more than six.
    costPlan = {
      columns: [
        "statement_id",
        "hour_total_ms",
        "execution_duration_ms",
        "hour_billable_usd",
        "currency_code",
        "sku_name",
      ],
      rows: [
        [
          STATEMENT_ID,
          "3600000",
          "900000",
          "6.00",
          "USD",
          "PREMIUM_SERVERLESS_SQL_COMPUTE_EU_WEST",
        ],
      ],
    };

    const result = await pull({ warehouseId: WAREHOUSE_ID });

    expect(result.events).toHaveLength(1);
    expect(hintOf(result).costUsd).toBe("0");
  });

  /** @scenario "Billing answered in a shape we did not ask for is not priced from" */
  it("refuses to price an answer that does not say what its columns are", async () => {
    // No manifest at all. The rows still parse — they are strings — so without
    // the names nothing downstream could tell this answer from a reordered one.
    costPlan = {
      columns: [],
      rows: [
        [
          STATEMENT_ID,
          "3600000",
          "3600000",
          "6.00",
          "USD",
          "PREMIUM_SERVERLESS_SQL_COMPUTE_EU_WEST",
        ],
      ],
    };

    const result = await pull({ warehouseId: WAREHOUSE_ID });

    expect(result.events).toHaveLength(1);
    expect(hintOf(result).costUsd).toBe("0");
  });

  /** @scenario "A question that ran no SQL is charged nothing" */
  it("charges nothing for a question Genie answered without a query", async () => {
    messageRanSql = false;
    costPlan = {
      rows: [
        [
          STATEMENT_ID,
          "3600000",
          "3600000",
          "6.00",
          "USD",
          "PREMIUM_SERVERLESS_SQL_COMPUTE_EU_WEST",
        ],
      ],
    };

    const result = await pull({ warehouseId: WAREHOUSE_ID });

    expect(result.events).toHaveLength(1);
    // A priced statement exists in the window; this question simply is not it.
    expect(hintOf(result).costUsd).toBe("0");
  });

  /** @scenario "The puller's own billing query is not charged to a question" */
  it("charges no question for compute no question asked for", async () => {
    costPlan = {
      rows: [
        [
          "some-other-statement",
          "3600000",
          "3600000",
          "6.00",
          "USD",
          "PREMIUM_SERVERLESS_SQL_COMPUTE_EU_WEST",
        ],
      ],
    };

    const result = await pull({ warehouseId: WAREHOUSE_ID });

    // Compute that belongs to no Genie question — the puller's own billing
    // query among it — is never handed to whichever question happens to be here.
    expect(hintOf(result).costUsd).toBe("0");
  });

  /** @scenario "A priced question calls its figure an estimate" */
  it("marks a priced figure an estimate", async () => {
    costPlan = {
      rows: [
        [
          STATEMENT_ID,
          "3600000",
          "3600000",
          "6.00",
          "USD",
          "PREMIUM_SERVERLESS_SQL_COMPUTE_EU_WEST",
        ],
      ],
    };

    const result = await pull({ warehouseId: WAREHOUSE_ID });

    expect(hintOf(result).costUsd).toBe("6");
    // The account's discount is on no table this token reads, so the figure is
    // the published rate and has to say so.
    expect(hintOf(result).costStatus).toBe("estimate");
  });

  /** @scenario "A cost answer that was cut short prices nothing" */
  it("prices nothing from an answer that filled the row limit", async () => {
    // This question's own row is first and fully priced, so an adapter that
    // used the answer would charge it $6. A full page means the rows we cannot
    // see are missing, and there is no way to tell which questions they were.
    const filler = Array.from(
      { length: WAREHOUSE_COST_ROW_LIMIT - 1 },
      (_, i): (string | null)[] => [
        `other-statement-${i}`,
        "1",
        "3600000",
        "6.00",
        "USD",
        "PREMIUM_SERVERLESS_SQL_COMPUTE_EU_WEST",
      ],
    );
    costPlan = {
      rows: [
        [
          STATEMENT_ID,
          "3600000",
          "3600000",
          "6.00",
          "USD",
          "PREMIUM_SERVERLESS_SQL_COMPUTE_EU_WEST",
        ],
        ...filler,
      ],
    };

    const result = await pull({ warehouseId: WAREHOUSE_ID });

    expect(hintOf(result).costUsd).toBe("0");
  });

  /** @scenario "Cost that arrives late corrects the record rather than adding one" */
  it("corrects a question's zero when the bill lands, on the same record", async () => {
    messageCreatedMs = Date.now() - 30 * 60 * 1000;

    // First run: the compute has not been published yet.
    costPlan = { rows: [] };
    const first = await pull({ warehouseId: WAREHOUSE_ID });
    expect(hintOf(first).costUsd).toBe("0");

    // Second run, after the bill lands.
    costPlan = {
      rows: [
        [
          STATEMENT_ID,
          "3600000",
          "3600000",
          "6.00",
          "USD",
          "PREMIUM_SERVERLESS_SQL_COMPUTE_EU_WEST",
        ],
      ],
    };
    const second = await pull({ warehouseId: WAREHOUSE_ID });

    expect(hintOf(second).costUsd).toBe("6");
    // Same question, so the same record — the ledger replaces on these
    // coordinates rather than adding a second row for one question.
    expect(second.events[0]?.source_event_id).toBe(
      first.events[0]?.source_event_id,
    );
    expect(
      (
        second.events[0]?.extra?.[PULLED_USAGE_HINT_KEY] as {
          dimensions: unknown;
        }
      ).dimensions,
    ).toEqual(
      (
        first.events[0]?.extra?.[PULLED_USAGE_HINT_KEY] as {
          dimensions: unknown;
        }
      ).dimensions,
    );
  });

  /** @scenario "A question's hour is priced whole or not at all" */
  it("asks about whole hours, so an hour's bill is never split off its queries", async () => {
    costPlan = { rows: [] };

    await pull({ warehouseId: WAREHOUSE_ID });

    const params = statementBodies[0]!.parameters as {
      name: string;
      value: string;
    }[];
    const from = Date.parse(params.find((p) => p.name === "from_ts")!.value);
    const to = Date.parse(params.find((p) => p.name === "to_ts")!.value);

    // The warehouse is billed by the hour and the queries are bucketed by the
    // hour. A window starting mid-hour drops that hour's bill while keeping its
    // queries, so every question in it silently prices at nothing.
    expect(from % (60 * 60 * 1000)).toBe(0);
    expect(to % (60 * 60 * 1000)).toBe(0);
  });

  /** @scenario "A question whose SQL has not reached the billing tables yet" */
  it("records the question anyway when its compute is not published yet", async () => {
    costPlan = { rows: [] };

    const result = await pull({ warehouseId: WAREHOUSE_ID });

    expect(result.events).toHaveLength(1);
    expect(hintOf(result).costUsd).toBe("0");
  });

  /** @scenario "A billing outage does not discard the questions" */
  it("keeps the questions when the workspace refuses the billing query", async () => {
    costPlan = { status: 403 };

    const result = await pull({ warehouseId: WAREHOUSE_ID });

    expect(result.events).toHaveLength(1);
    expect(hintOf(result).costUsd).toBe("0");
    // Not an error count: the sweep did its job. A source that reported a
    // failure here would look broken to an admin who has simply not granted
    // the billing tables.
    expect(result.errorCount).toBe(0);
  });

  it("keeps the questions when the billing query is cancelled on its wait", async () => {
    costPlan = { state: "PENDING" };

    const result = await pull({ warehouseId: WAREHOUSE_ID });

    expect(result.events).toHaveLength(1);
    expect(hintOf(result).costUsd).toBe("0");
  });

  /** @scenario "Compute the workspace prices in another currency is not converted" */
  it("records no cost for compute priced in another currency", async () => {
    costPlan = {
      rows: [
        [
          STATEMENT_ID,
          "3600000",
          "3600000",
          "6.00",
          "EUR",
          "PREMIUM_SERVERLESS_SQL_COMPUTE_EU_WEST",
        ],
      ],
    };

    const result = await pull({ warehouseId: WAREHOUSE_ID });

    expect(result.events).toHaveLength(1);
    expect(hintOf(result).costUsd).toBe("0");
  });

  /** @scenario "A source that prices its questions keeps looking back far enough" */
  it("still reads a question older than the watermark would allow", async () => {
    // Asked an hour ago: past the five-minute watermark lag, so a source that
    // did not widen its window would never see it again — and its cost only
    // becomes available at about this age.
    messageCreatedMs = Date.now() - 60 * 60 * 1000;
    costPlan = {
      rows: [
        [
          STATEMENT_ID,
          "3600000",
          "3600000",
          "6.00",
          "USD",
          "PREMIUM_SERVERLESS_SQL_COMPUTE_EU_WEST",
        ],
      ],
    };

    // A cursor whose watermark has already moved past the message.
    const puller = new DatabricksGeniePuller();
    const result = await puller.runOnce(
      {
        cursor: JSON.stringify({
          sinceMs: Date.now() - 10 * 60 * 1000,
          spaceId: null,
          conversationId: null,
          sweepHadGap: false,
          spaceSetFingerprint: null,
          sweepStartedAtMs: null,
          sweepOldestPendingMs: null,
        }),
        credentials: { token: "dapi-fixture" },
      },
      {
        adapter: DATABRICKS_GENIE_ADAPTER_ID,
        workspaceUrl: baseUrl,
        spaceIds: [],
        schedule: "*/15 * * * *",
        warehouseId: WAREHOUSE_ID,
      },
    );

    expect(result.events).toHaveLength(1);
    expect(hintOf(result).costUsd).toBe("6");
    // The window it asked billing about reaches back at least as far.
    const from = String(
      (
        statementBodies[0]!.parameters as { name: string; value: string }[]
      ).find((p) => p.name === "from_ts")?.value,
    );
    expect(Date.parse(from)).toBeLessThanOrEqual(
      Date.now() - WAREHOUSE_COST_SETTLING_LAG_MS + 60_000,
    );
  });

  /** @scenario "A source that prices nothing does not widen its window" */
  it("does not re-read an old question when the source prices nothing", async () => {
    messageCreatedMs = Date.now() - 60 * 60 * 1000;

    const puller = new DatabricksGeniePuller();
    const result = await puller.runOnce(
      {
        cursor: JSON.stringify({
          sinceMs: Date.now() - 10 * 60 * 1000,
          spaceId: null,
          conversationId: null,
          sweepHadGap: false,
          spaceSetFingerprint: null,
          sweepStartedAtMs: null,
          sweepOldestPendingMs: null,
        }),
        credentials: { token: "dapi-fixture" },
      },
      {
        adapter: DATABRICKS_GENIE_ADAPTER_ID,
        workspaceUrl: baseUrl,
        spaceIds: [],
        schedule: "*/15 * * * *",
      },
    );

    expect(result.events).toHaveLength(0);
  });
});
