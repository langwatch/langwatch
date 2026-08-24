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
import {
  WAREHOUSE_COST_MAX_HOLD_MS,
  WAREHOUSE_COST_SETTLING_LAG_MS,
} from "../databricksWarehouseCost";
import { PULLED_USAGE_HINT_KEY } from "@langwatch/enterprise-governance-contract";

const SPACE_ID = "space-1";
const CONVERSATION_ID = "conv-1";
const MESSAGE_ID = "msg-1";
const STATEMENT_ID = "stmt-abc";
const WAREHOUSE_ID = "095eb666b2ed2762";
/** The whole hour an instant falls in, as the workspace would report it. */
function usageHourOf(atMs: number): string {
  return new Date(
    Math.floor(atMs / (60 * 60 * 1000)) * (60 * 60 * 1000),
  ).toISOString();
}

/**
 * The hour a fixture row is about.
 *
 * The hour the sweep is running in, and not a fixed date, because the reply is
 * now served only to the chunk that owns the row's hour — the way a real
 * workspace answers, and the premise the sweep relies on when it adds a
 * straddler's chunks together. Every window these tests read, from two hours to
 * thirty days, ends at the sweep's own clock, so this is the one hour all of
 * them contain.
 */
const USAGE_HOUR = usageHourOf(Date.now());

type CostPlan = {
  status?: number;
  state?: string;
  rows?: (string | null)[][];
  columns?: string[];
  /** Set when the reply is one chunk of a larger answer. */
  nextChunkIndex?: number;
  /** What the manifest claims the query produced, which may exceed `rows`. */
  totalRowCount?: number;
};

/**
 * The rows a real reply would carry back for the window it was asked about.
 *
 * The workspace answers per chunk, and the chunks tile the window: an hour
 * belongs to exactly one of them, which is what lets the sweep add a
 * straddler's chunks together without doubling anything. A fixture that served
 * every row to every chunk would break that premise silently — the same
 * statement-hour would arrive once per chunk and its cost would multiply by how
 * many chunks the window happened to split into.
 *
 * Rows whose columns do not name `usage_hour` are served whole: those plans are
 * about the adapter refusing a reply it cannot read, and the window is not what
 * they are testing.
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
  const at = columns.indexOf("usage_hour");
  if (at === -1) return rows;

  const parameters = (body.parameters ?? []) as {
    name: string;
    value: string;
  }[];
  const bound = (name: string): number => {
    const found = parameters.find((parameter) => parameter.name === name);
    return found === undefined ? NaN : Date.parse(found.value);
  };
  const fromMs = bound("from_ts");
  const toMs = bound("to_ts");
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs)) return rows;

  return rows.filter((row) => {
    const hourMs = Date.parse(String(row[at]));
    if (!Number.isFinite(hourMs)) return true;
    return hourMs >= fromMs && hourMs < toMs;
  });
}

let server: http.Server;
let baseUrl: string;
/** Bodies the fixture was asked to run a statement with, in order. */
let statementBodies: Record<string, unknown>[];
/** What each of those calls was answered with, in the same order. */
let servedRows: (string | null)[][][];
let costPlan: CostPlan | null;
/** Plans that answer the first N cost calls, in order, before `costPlan`. */
let costPlanQueue: CostPlan[];
/** Message creation time, moved by tests that care about the read window. */
let messageCreatedMs: number;
let messageRanSql: boolean;

beforeEach(async () => {
  statementBodies = [];
  servedRows = [];
  costPlan = null;
  costPlanQueue = [];
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
        // Queued plans answer one call each, then `costPlan` answers the rest.
        // Only tests about WHICH day was unpriced need this; the rest set one
        // plan and mean it for every window.
        const plan = costPlanQueue.shift() ?? costPlan;
        if (plan?.status) {
          res.statusCode = plan.status;
          return send({ message: "permission denied" });
        }
        const columns = plan?.columns ?? [
          "statement_id",
          "usage_hour",
          "execution_ms_in_hour",
          "hour_total_ms",
          "hour_billable_usd",
          "currency_code",
          "sku_name",
        ];
        const served = rowsInWindow({
          rows: plan?.rows ?? [],
          columns,
          body: statementBodies[statementBodies.length - 1]!,
        });
        servedRows.push(served);
        send({
          statement_id: "fixture",
          status: { state: plan?.state ?? "SUCCEEDED" },
          manifest: {
            schema: { columns: columns.map((name) => ({ name })) },
            ...(plan?.totalRowCount === undefined
              ? {}
              : { total_row_count: plan.totalRowCount }),
          },
          result: {
            data_array: served,
            ...(plan?.nextChunkIndex === undefined
              ? {}
              : { next_chunk_index: plan.nextChunkIndex }),
          },
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

async function pull({
  warehouseId,
  deadlineMs,
}: {
  warehouseId?: string;
  deadlineMs?: number;
}) {
  const puller = new DatabricksGeniePuller();
  return await puller.runOnce(
    {
      cursor: null,
      credentials: { token: "dapi-fixture" },
      ...(deadlineMs === undefined ? {} : { deadlineMs }),
    },
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
    expect(result.events[0]?.cost_usd).toBe("0");
    expect(hintOf(result).costUsd).toBe("0");
    // The claim that matters: not merely that cost is zero, but that a source
    // which opted out never went near the billing tables.
    expect(statementBodies).toHaveLength(0);
  });
});

describe("a source whose run has no time left to read billing", () => {
  /** @scenario "A run too short to price keeps the questions it read" */
  it("keeps every question it swept instead of starting a read the deadline will kill", async () => {
    // Less headroom than one billing read is allowed to take. The read cannot
    // finish, and the worker kills the whole run at the deadline — taking the
    // swept questions with it and leaving the cursor where it was, so the next
    // run does the same thing again.
    const result = await pull({
      warehouseId: WAREHOUSE_ID,
      deadlineMs: Date.now() + 1_000,
    });

    // The questions survive, unpriced. That is the whole point: an unpriced
    // window is asked again next run, a discarded sweep is not.
    expect(result.events).toHaveLength(1);
    expect(result.events[0]?.cost_usd).toBe("0");
    // And it never opened a request it could not have finished.
    expect(statementBodies).toHaveLength(0);
  });
});

describe("a source that names a warehouse", () => {
  /** @scenario "The billing query only ever runs on the configured workspace" */
  it("sends the billing query to the workspace address on the source", async () => {
    costPlan = { rows: [] };

    await pull({ warehouseId: WAREHOUSE_ID });

    // The only server in this test is the one at the source's workspace URL,
    // so a statement landing here landed at the address on the source. What
    // makes the assertion bite is the converse: the puller holds no other
    // address to send it to, and the fake would have answered nothing else.
    expect(statementBodies.length).toBeGreaterThan(0);
  });

  /** @scenario "The compute behind a question is charged to the person who asked" */
  it("carries the question's share of the warehouse bill", async () => {
    costPlan = {
      rows: [
        [
          STATEMENT_ID,
          USAGE_HOUR,
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
    expect(result.events[0]?.cost_usd).toBe("3");
    // Still an estimate: the figure is a share worked out from list prices.
    expect(hintOf(result).costStatus).toBe("estimate");
    // And still attributed to the person who asked.
    expect(result.events[0]?.actor).toBe("dana@acme.test");
  });

  /** @scenario "A query that outlives one billing read is charged in full" */
  it("adds up a statement the window was read in two pieces of", async () => {
    // The window is read oldest-first in chunks that tile it, and each chunk
    // answers only for the hours it owns. A statement still running when a
    // chunk ends therefore comes back twice, once from each side of the
    // boundary, with a different part of itself each time — and the sweep
    // emits its question exactly once. Keeping only the last answer is the
    // defect: the earlier hours are billed to nobody while still diluting
    // every other question's share of them.
    //
    // Ten days apart, so the two hours cannot land in the same seven-day
    // chunk however the window happens to be aligned.
    const earlierHour = usageHourOf(Date.now() - 10 * 24 * 60 * 60 * 1000);
    costPlan = {
      rows: [
        // Half of a $12 hour.
        [
          STATEMENT_ID,
          earlierHour,
          "1800000",
          "3600000",
          "12.00",
          "USD",
          "PREMIUM_SERVERLESS_SQL_COMPUTE_EU_WEST",
        ],
        // And a sixth of a $6 one.
        [
          STATEMENT_ID,
          USAGE_HOUR,
          "600000",
          "3600000",
          "6.00",
          "USD",
          "PREMIUM_SERVERLESS_SQL_COMPUTE_EU_WEST",
        ],
      ],
    };

    const result = await pull({ warehouseId: WAREHOUSE_ID });

    // The premise first: the two hours really were answered by two different
    // calls. Without this the sum below would also pass on a fixture that
    // handed both rows to one chunk, which is the one arrangement that cannot
    // exercise the merge.
    const callsCarrying = (hour: string) =>
      servedRows.filter((rows) => rows.some((row) => row[1] === hour)).length;
    expect(callsCarrying(earlierHour)).toBe(1);
    expect(callsCarrying(USAGE_HOUR)).toBe(1);
    expect(
      servedRows.findIndex((rows) =>
        rows.some((row) => row[1] === earlierHour),
      ),
    ).not.toBe(
      servedRows.findIndex((rows) => rows.some((row) => row[1] === USAGE_HOUR)),
    );

    // $6 from the earlier hour and $1 from the later one, exactly.
    expect(hintOf(result).costUsd).toBe("7");
    expect(result.events[0]?.cost_usd).toBe("7");
    // And the ingredients span both hours, because each is a sum over the
    // hours the statement ran through and the chunks partition those hours.
    expect(result.events[0]?.extra?.warehouseHour).toEqual({
      totalExecutionMs: "7200000",
      billableUsd: "18",
    });
  });

  /** @scenario "A priced question carries the numbers its share was worked out from" */
  it("carries the hour's bill and executed time beside the cost", async () => {
    costPlan = {
      rows: [
        [
          STATEMENT_ID,
          USAGE_HOUR,
          "1800000",
          "3600000",
          "6.00",
          "USD",
          "PREMIUM_SERVERLESS_SQL_COMPUTE_EU_WEST",
        ],
      ],
    };

    const result = await pull({ warehouseId: WAREHOUSE_ID });

    // The share's raw ingredients, so "$3 for half an hour's execution" can be
    // read off the record itself. Raw and never a percentage: the executed-time
    // sum is unclamped over concurrent statements, and an auto-stopping
    // warehouse makes a clock-hour denominator lie.
    expect(result.events[0]?.extra?.warehouseHour).toEqual({
      totalExecutionMs: "3600000",
      billableUsd: "6",
    });
    // Beside the hint, never in it: derived values in the hint would enter the
    // restatement key and a correction would mint a second ledger record.
    expect(hintOf(result)).not.toHaveProperty("warehouseHour");
  });

  /** @scenario "A question is still priced after the provider renames its client label" */
  it("asks for statements by space id, not only by the client label", async () => {
    costPlan = { rows: [] };

    await pull({ warehouseId: WAREHOUSE_ID });

    // The fixture cannot execute SQL, so what these pin is the question asked:
    // Databricks evaluates the union, and each half alone is a cliff — the
    // label is a display string the provider can rename at will.
    const sql = String(statementBodies[0]!.statement);
    expect(sql).toContain("w.genie_space_id IS NOT NULL");
    expect(sql).toContain("OR w.client_application = :genie_app");
  });

  /** @scenario "Traffic that began before the hour keeps its share of the bill" */
  it("asks for execution time by the hours a statement ran in, not the one it began in", async () => {
    costPlan = { rows: [] };

    await pull({ warehouseId: WAREHOUSE_ID });

    // The fixture cannot execute SQL, so what this pins is the question asked.
    // The defect it guards is invisible in any result set: bucketing a
    // statement wholly into its start hour leaves the NEXT hour's denominator
    // holding only what happened to begin in it, and a one-second Genie
    // question in that hour carries the whole hour's bill.
    const sql = String(statementBodies[0]!.statement);

    // The statement's end is read, and reconstructed when the row has none —
    // an in-flight statement with a null end_time would otherwise drop out of
    // the denominator entirely.
    expect(sql).toMatch(/COALESCE\(\s*end_time,/);
    expect(sql).toContain("execution_duration_ms");

    // One row per hour the statement was awake in, not one per statement, and
    // the span it is cut into runs from the statement's own start. Naming the
    // bound matters more than naming the alias: bucketing every statement back
    // into its start hour would keep all the aliases below and change only
    // this line, which is exactly the defect this test exists to catch.
    expect(sql).toMatch(
      /explode\(\s*sequence\(\s*date_trunc\('HOUR',\s*r\.start_time\)/,
    );

    // And the share's numerator is the part of the runtime inside THAT hour,
    // divided with `div`. Spark's `/` returns a DOUBLE; a float here is money
    // computed in floating point, which the rest of this path is built to
    // avoid.
    expect(sql).toContain("execution_ms_in_hour");
    expect(sql).toMatch(/r\.execution_duration_ms\s*\*[\s\S]{0,200}?\bdiv\b/);
    expect(sql).not.toMatch(/r\.execution_duration_ms\s*\//);

    // The hour each row belongs to travels with it. Without it the allocator
    // cannot tell one statement's two hours from one hour's two SKUs, and it
    // has to treat them differently: two hours sum their totals, two SKUs do
    // not, and an unbilled hour holds the watermark where an unbilled SKU
    // beside a priced one does not.
    expect(sql).toContain("usage_hour");

    // The last hour is half-open. `sequence` includes its stop value, so a
    // statement ending at exactly 10:00:00.000 would otherwise emit a 10:00
    // slice it did no work in — and if the warehouse shut down at 10:00, that
    // hour never bills, the null SKU reads as "not billed yet", and the source
    // stalls for the seven-day hold. Every hourly scheduled query ends on a
    // boundary.
    expect(sql).toMatch(/unix_millis\(\s*r\.ended_at\s*\)\s*-\s*1\b/);

    // And an HOUR decides which chunk answers for a row, not the statement's
    // start. The window is read in chunks that tile it, so gating emission on
    // `start_time` hands a straddler wholly to the chunk it began in — which
    // has already dropped the hours past its own end. The next chunk counts
    // that statement in its denominators and then excludes it from its rows,
    // so those hours are billed to nobody while still diluting everyone else.
    // The hour clip below is what keeps each statement-hour emitted exactly
    // once across the whole window.
    expect(sql).toMatch(/h\.usage_hour\s*>=\s*:from_ts/);
    expect(sql).toMatch(/h\.usage_hour\s*<\s*:to_ts/);
    expect(sql).not.toMatch(/w\.start_time\s*>=\s*:from_ts/);
  });

  /** @scenario "A question is still priced when its history row names no space" */
  it("asks for statements by client label even when a row names no space", async () => {
    costPlan = { rows: [] };

    await pull({ warehouseId: WAREHOUSE_ID });

    // The other half of the union: a runtime that stops populating the space
    // id must not silently drop the cost the label half still finds. OR, not
    // AND — a row missing either mark still prices on the other.
    const sql = String(statementBodies[0]!.statement);
    expect(sql).toContain("w.client_application = :genie_app");
    expect(sql).toMatch(
      /WHERE \(w\.genie_space_id IS NOT NULL OR w\.client_application = :genie_app\)/,
    );
  });

  /**
   * @scenario "A question is priced by the warehouse that answered it, not the
   * one the connector signs in to"
   */
  it("runs the billing query on the configured warehouse without restricting the answer to it", async () => {
    costPlan = { rows: [] };

    await pull({ warehouseId: WAREHOUSE_ID });

    // A day at a time, so one busy day cannot cost the whole window its price.
    // Every one of them still runs on the configured warehouse: that id says
    // where the query executes, and chunking multiplied the number of chances
    // to get that wrong.
    expect(statementBodies.length).toBeGreaterThan(1);
    for (const sent of statementBodies) {
      expect(sent.warehouse_id).toBe(WAREHOUSE_ID);
    }

    const body = statementBodies[0]!;
    // And nothing narrows the answer to that same warehouse. A Genie space
    // answers on whichever warehouse it was built against, which is routinely
    // not the one the connector holds `CAN USE` on — pricing only the executor
    // would return an empty answer and call it a cost of nothing.
    expect(body.parameters).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "warehouse_id" }),
      ]),
    );
    expect(String(body.statement)).not.toContain(":warehouse_id");
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
        "usage_hour",
        "hour_total_ms",
        "execution_ms_in_hour",
        "hour_billable_usd",
        "currency_code",
        "sku_name",
      ],
      rows: [
        [
          STATEMENT_ID,
          USAGE_HOUR,
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
          USAGE_HOUR,
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
          USAGE_HOUR,
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
          USAGE_HOUR,
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
          USAGE_HOUR,
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
        USAGE_HOUR,
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
          USAGE_HOUR,
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

  /** @scenario "A cost answer that was cut short prices nothing" */
  it("prices nothing from one chunk of a larger answer", async () => {
    // The reply is well under the row limit and this question's own row is in
    // it, fully priced. What says it is incomplete is the pointer to the rest —
    // an INLINE answer is capped by size as well as by row count, so this is
    // the form of truncation a row count would call complete.
    costPlan = {
      rows: [
        [
          STATEMENT_ID,
          USAGE_HOUR,
          "3600000",
          "3600000",
          "6.00",
          "USD",
          "PREMIUM_SERVERLESS_SQL_COMPUTE_EU_WEST",
        ],
      ],
      nextChunkIndex: 1,
    };

    const result = await pull({ warehouseId: WAREHOUSE_ID });

    expect(hintOf(result).costUsd).toBe("0");
  });

  /** @scenario "A cost answer that was cut short prices nothing" */
  it("prices nothing when the manifest counts more rows than arrived", async () => {
    costPlan = {
      rows: [
        [
          STATEMENT_ID,
          USAGE_HOUR,
          "3600000",
          "3600000",
          "6.00",
          "USD",
          "PREMIUM_SERVERLESS_SQL_COMPUTE_EU_WEST",
        ],
      ],
      totalRowCount: 2,
    };

    const result = await pull({ warehouseId: WAREHOUSE_ID });

    expect(hintOf(result).costUsd).toBe("0");
  });

  /** @scenario "A window whose cost was cut short is asked about again" */
  it("holds the watermark on the day it could not price", async () => {
    // A first sweep reads thirty days. Pricing nothing is survivable; pricing
    // nothing AND moving the watermark past those thirty days is not, because
    // later runs re-read only the settling window and would never look at them
    // again. The zero would be the permanent answer to a question that really
    // was billed.
    costPlan = {
      rows: [
        [
          STATEMENT_ID,
          USAGE_HOUR,
          "3600000",
          "3600000",
          "6.00",
          "USD",
          "PREMIUM_SERVERLESS_SQL_COMPUTE_EU_WEST",
        ],
      ],
      nextChunkIndex: 1,
    };

    const result = await pull({ warehouseId: WAREHOUSE_ID });
    const cursor = JSON.parse(result.cursor!) as { sinceMs: number };

    expect(hintOf(result).costUsd).toBe("0");
    // Still back at the start of the window, not up at the sweep's clock.
    expect(cursor.sinceMs).toBeLessThan(Date.now() - 29 * 24 * 60 * 60 * 1000);
    // And it stopped at the first period it could not price, rather than
    // spending the rest of the run's budget on periods it would refuse anyway.
    // Two questions, not one: the chunk, then the first day of it, because a
    // chunk that cannot be answered whole is re-asked smaller before the walk
    // gives up on it. Both refuse here, so the walk stops at the second.
    expect(statementBodies).toHaveLength(2);

    // The half that holding the watermark exists for, and the half a cursor
    // assertion alone does not show: the next run, resuming from that cursor,
    // asks about the same period again — and prices it once billing answers.
    const refusedFrom = statementBodies[0]!.parameters as Array<{
      name: string;
      value: string;
    }>;
    const askedAboutFirst = refusedFrom.find(
      (p) => p.name === "from_ts",
    )!.value;

    statementBodies.length = 0;
    costPlan = {
      rows: [
        [
          STATEMENT_ID,
          USAGE_HOUR,
          "3600000",
          "3600000",
          "6.00",
          "USD",
          "PREMIUM_SERVERLESS_SQL_COMPUTE_EU_WEST",
        ],
      ],
    };

    const second = await new DatabricksGeniePuller().runOnce(
      { cursor: result.cursor, credentials: { token: "dapi-fixture" } },
      {
        adapter: DATABRICKS_GENIE_ADAPTER_ID,
        workspaceUrl: baseUrl,
        spaceIds: [],
        schedule: "*/15 * * * *",
        warehouseId: WAREHOUSE_ID,
      },
    );

    const askedAboutAgain = (
      statementBodies[0]!.parameters as Array<{ name: string; value: string }>
    ).find((p) => p.name === "from_ts")!.value;

    // Same period, not a window that moved on past it.
    expect(askedAboutAgain).toBe(askedAboutFirst);
    // And the question that was recorded at zero now carries its real share.
    expect(hintOf(second).costUsd).toBe("6");
  });

  /**
   * @scenario "A question seen before its bill has landed is asked about again,
   * however far back it sits"
   */
  it("holds the watermark for a question seen but not billed yet, past the settling window", async () => {
    // The defect this whole change exists to stop. The billing query SUCCEEDS
    // and answers about the statement — the LEFT JOIN keeps it — but its hour
    // has no billing row yet, so the SKU comes back null. The old inner join
    // dropped it, the chunk read as fully priced, the watermark jumped to the
    // sweep's clock, and the fixed settling re-read never reached back to it
    // again: a permanent zero for a question that really was billed.
    //
    // A null SKU in the last column is exactly what the LEFT JOIN produces for
    // an unbilled hour.
    costPlan = {
      rows: [
        [STATEMENT_ID, USAGE_HOUR, "3600000", "3600000", null, null, null],
      ],
    };

    const result = await pull({ warehouseId: WAREHOUSE_ID });
    const cursor = JSON.parse(result.cursor!) as { sinceMs: number };

    // Recorded at zero for now — its bill does not exist yet to price from.
    expect(hintOf(result).costUsd).toBe("0");
    // But the watermark held BEHIND the unbilled hour, not at the sweep's
    // clock. This is the assertion the old code failed: a seen-but-unbilled
    // statement would have been passed over for good. The bound is the hour
    // itself rather than the far end of the window, because the hold lands at
    // the start of the chunk that could not be priced — the one owning this
    // hour — and every earlier chunk keeps the cost it already worked out.
    expect(cursor.sinceMs).toBeLessThan(Date.parse(USAGE_HOUR));

    // The other half: resuming from that held cursor, once the bill lands, the
    // same question is asked about again and now carries its real share.
    costPlan = {
      rows: [
        [
          STATEMENT_ID,
          USAGE_HOUR,
          "3600000",
          "3600000",
          "6.00",
          "USD",
          "PREMIUM_SERVERLESS_SQL_COMPUTE_EU_WEST",
        ],
      ],
    };

    const second = await new DatabricksGeniePuller().runOnce(
      { cursor: result.cursor, credentials: { token: "dapi-fixture" } },
      {
        adapter: DATABRICKS_GENIE_ADAPTER_ID,
        workspaceUrl: baseUrl,
        spaceIds: [],
        schedule: "*/15 * * * *",
        warehouseId: WAREHOUSE_ID,
      },
    );

    expect(hintOf(second).costUsd).toBe("6");
  });

  /** @scenario "A window whose cost was cut short is asked about again" */
  it("moves the watermark on when every day priced whole", async () => {
    // The other half of the claim above: holding is what an unpriced day costs,
    // not what every run does. A source that could price its window has to make
    // progress, or the hold would be a stall wearing a correctness argument.
    costPlan = { rows: [] };

    const result = await pull({ warehouseId: WAREHOUSE_ID });
    const cursor = JSON.parse(result.cursor!) as { sinceMs: number };

    expect(cursor.sinceMs).toBeGreaterThan(Date.now() - 60 * 60 * 1000);
  });

  /** @scenario "A window whose cost was cut short is asked about again" */
  it("moves the watermark on when billing refuses the question outright", async () => {
    // Deliberately NOT held. A cut-short answer proves rows exist that a
    // narrower question could still reach; a refusal proves nothing, and asking
    // again would be refused the same way. Holding here would stall a workspace
    // that never granted the billing tables, forever, with no way out but
    // turning the feature off — a worse failure than the questions carrying no
    // cost, which is what they carried before any of this existed.
    costPlan = { status: 403 };

    const result = await pull({ warehouseId: WAREHOUSE_ID });
    const cursor = JSON.parse(result.cursor!) as { sinceMs: number };

    expect(cursor.sinceMs).toBeGreaterThan(Date.now() - 60 * 60 * 1000);
  });

  /** @scenario "A window whose cost was cut short is asked about again" */
  it("keeps a question asked on the unpriced period's first instant", async () => {
    // The seam between the two half-open windows. Costs are asked for
    // `start_time >= from`, so a statement AT the unpriced period's start is
    // inside it; questions are kept for `created > watermark`, so a watermark
    // sitting exactly on that instant drops the question standing on it. It
    // would be recorded at zero once and then filtered out of every later run.
    // Chunks are hour-aligned, so this only reaches a question asked exactly on
    // the hour — rare, and permanent every time it lands.
    const oneHourMs = 60 * 60 * 1000;
    const watermark =
      Math.floor((Date.now() - 3 * 24 * oneHourMs) / oneHourMs) * oneHourMs;
    // The second day is the one that cannot be priced, so the ceiling lands
    // ahead of the old watermark and the seam is actually load-bearing. A
    // first-day refusal would hold at the old watermark and prove nothing.
    messageCreatedMs = watermark + 24 * oneHourMs;
    // The whole window is one chunk, so the seam is reached the way it is
    // reached in practice: the chunk cannot be answered whole, it is re-asked
    // in days, the first day answers and the second does not.
    costPlanQueue = [
      { rows: [], nextChunkIndex: 1 },
      { rows: [] },
      { rows: [], nextChunkIndex: 1 },
    ];
    costPlan = { rows: [], nextChunkIndex: 1 };

    const runFrom = async (cursor: string) =>
      await new DatabricksGeniePuller().runOnce(
        { cursor, credentials: { token: "dapi-fixture" } },
        {
          adapter: DATABRICKS_GENIE_ADAPTER_ID,
          workspaceUrl: baseUrl,
          spaceIds: [],
          schedule: "*/15 * * * *",
          warehouseId: WAREHOUSE_ID,
        },
      );

    const first = await runFrom(JSON.stringify({ sinceMs: watermark }));
    expect(first.events).toHaveLength(1);
    // Behind the question, not level with it. Level is the bug: one millisecond
    // of overlap is what buys the question another look.
    const cursor = JSON.parse(first.cursor!) as { sinceMs: number };
    expect(cursor.sinceMs).toBeLessThan(messageCreatedMs);

    // And the look actually happens, which is the part a cursor comparison
    // cannot show: the same question comes back, and prices, once billing can
    // answer for that day.
    costPlanQueue = [];
    costPlan = {
      rows: [
        [
          STATEMENT_ID,
          USAGE_HOUR,
          "3600000",
          "3600000",
          "6.00",
          "USD",
          "PREMIUM_SERVERLESS_SQL_COMPUTE_EU_WEST",
        ],
      ],
    };
    const second = await runFrom(first.cursor!);

    expect(second.events).toHaveLength(1);
    expect(second.events[0]?.source_event_id).toBe(
      first.events[0]?.source_event_id,
    );
    expect(hintOf(second).costUsd).toBe("6");
  });

  /** @scenario "A period that can never be priced is eventually given up on" */
  it("gives up on a period that is refused for longer than the hold allows", async () => {
    // A day busier than one reply can carry is cut short identically on every
    // future run. Held without a bound, the source pins itself to one instant
    // and re-sweeps a wider window each run to wait for an answer that cannot
    // come. This is the run after the bet stops paying.
    costPlan = { rows: [], nextChunkIndex: 1 };

    // A cursor that has been holding for longer than the bet is worth — where
    // the unbounded version parked itself and never left. Held-since, not
    // how far back: a first sweep is thirty days behind and perfectly healthy.
    const stuckSinceMs = Date.now() - 30 * 24 * 60 * 60 * 1000;
    const result = await new DatabricksGeniePuller().runOnce(
      {
        cursor: JSON.stringify({
          sinceMs: stuckSinceMs,
          costHeldSinceMs:
            Date.now() - WAREHOUSE_COST_MAX_HOLD_MS - 60 * 60 * 1000,
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
    const cursor = JSON.parse(result.cursor!) as {
      sinceMs: number;
      costHeldSinceMs: number | null;
    };

    // It moved — the source is no longer pinned to that instant.
    expect(cursor.sinceMs).toBeGreaterThan(Date.now() - 60 * 60 * 1000);
    // And the stamp is cleared with it. Left behind, it would expire every
    // future hold the moment it started and the retry would never work again.
    expect(cursor.costHeldSinceMs).toBeNull();
    // The questions in the abandoned period keep the zero they came with,
    // rather than being dropped or invented.
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
          USAGE_HOUR,
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
          USAGE_HOUR,
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
          USAGE_HOUR,
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

/**
 * How much of the window one billing question covers, and what happens to the
 * rest of it when that question is not answered.
 *
 * The three things asserted here were one thing in the code: a reply that is
 * not a success. Reading them as one is what put a month of real spend at zero
 * — permanently, because later runs re-read only the settling window.
 */
describe("a month of questions to price", () => {
  /** @scenario "Pricing a month of questions fits in the time a run is given" */
  it("asks the warehouse for billing few enough times to finish in one run", async () => {
    costPlan = { rows: [] };

    await pull({ warehouseId: WAREHOUSE_ID });

    // A run is given five minutes and one billing question is allowed a minute
    // of it, so a first sweep that needs more questions than this cannot finish
    // however healthy the workspace is. Counted rather than timed on purpose:
    // the fixture answers instantly, so a deadline assertion here would pass on
    // exactly the defect this is here for.
    expect(statementBodies.length).toBeLessThanOrEqual(5);
  });

  /** @scenario "Pricing a month of questions fits in the time a run is given" */
  it("gives each billing question longer to answer than the warehouse usually takes", async () => {
    costPlan = { rows: [] };

    await pull({ warehouseId: WAREHOUSE_ID });

    // Measured against the real workspace on 2026-08-19: five sequential reads
    // of a week each came back in 10.8s, 23.4s, 26.9s, 37.7s and 22.0s. A limit
    // of thirty seconds sits inside that spread, so the warehouse cancels a
    // question it was answering perfectly well — and a cancelled answer used to
    // cost the rest of the window its cost figure for good.
    expect(statementBodies[0]?.wait_timeout).toBe("50s");
  });
});

describe("a billing answer that did not come back", () => {
  /** @scenario "A cost answer cancelled for taking too long is asked about again" */
  it("asks again about a period whose answer was cancelled for taking too long", async () => {
    // What the warehouse says when it runs out of the time the request allowed
    // it. Not a refusal: the same question asked again, or asked about less,
    // answers fine — which is exactly what makes writing it off so expensive.
    costPlan = { state: "CANCELED", rows: [] };

    const result = await pull({ warehouseId: WAREHOUSE_ID });
    const cursor = JSON.parse(result.cursor!) as { sinceMs: number };

    expect(hintOf(result).costUsd).toBe("0");
    // Still back at the start of the month. A watermark up at the sweep's clock
    // means those thirty days are never looked at again and their zero is final.
    expect(cursor.sinceMs).toBeLessThan(Date.now() - 29 * 24 * 60 * 60 * 1000);

    // The half a cursor assertion alone cannot show, for the reason the spec
    // gives: inside the settling look-back a period is re-read whatever the
    // watermark says. The instant that separates the two is the period's first.
    const askedAboutFirst = (
      statementBodies[0]!.parameters as Array<{ name: string; value: string }>
    ).find((p) => p.name === "from_ts")!.value;

    statementBodies.length = 0;
    costPlan = {
      rows: [
        [
          STATEMENT_ID,
          USAGE_HOUR,
          "3600000",
          "3600000",
          "6.00",
          "USD",
          "PREMIUM_SERVERLESS_SQL_COMPUTE_EU_WEST",
        ],
      ],
    };

    const second = await new DatabricksGeniePuller().runOnce(
      { cursor: result.cursor, credentials: { token: "dapi-fixture" } },
      {
        adapter: DATABRICKS_GENIE_ADAPTER_ID,
        workspaceUrl: baseUrl,
        spaceIds: [],
        schedule: "*/15 * * * *",
        warehouseId: WAREHOUSE_ID,
      },
    );

    const askedAboutAgain = (
      statementBodies[0]!.parameters as Array<{ name: string; value: string }>
    ).find((p) => p.name === "from_ts")!.value;

    expect(askedAboutAgain).toBe(askedAboutFirst);
    expect(hintOf(second).costUsd).toBe("6");
  });

  /** @scenario "Billing refusing the question outright is still not held" */
  it("moves on when the statement itself fails", async () => {
    // A missing grant comes back as a request that succeeded carrying a
    // statement that did not. Asking about less would fail the same way, so
    // holding here would stall the source with no way out but turning the
    // feature off. Green before the change above and required to stay green
    // after it: that is the whole reason the cancelled case is phrased about
    // time rather than about failure.
    costPlan = { state: "FAILED", rows: [] };

    const result = await pull({ warehouseId: WAREHOUSE_ID });
    const cursor = JSON.parse(result.cursor!) as { sinceMs: number };

    expect(result.events).toHaveLength(1);
    expect(cursor.sinceMs).toBeGreaterThan(Date.now() - 60 * 60 * 1000);
  });

  /** @scenario "Billing refusing the question outright is still not held" */
  it("moves on when the workspace rejects the request outright", async () => {
    // The other door to the same answer: a revoked or unprivileged token is
    // refused before any statement runs. Both have to reach the same place.
    costPlan = { status: 403 };

    const result = await pull({ warehouseId: WAREHOUSE_ID });
    const cursor = JSON.parse(result.cursor!) as { sinceMs: number };

    expect(result.events).toHaveLength(1);
    expect(cursor.sinceMs).toBeGreaterThan(Date.now() - 60 * 60 * 1000);
  });
});

describe("a period with more statements than one answer can carry", () => {
  /** @scenario "A period the answer cannot carry whole is re-asked in smaller pieces" */
  it("prices the parts of it that can be priced instead of surrendering it whole", async () => {
    // The first week of the month cannot be carried whole. Two days of it can;
    // the third cannot either.
    costPlanQueue = [
      { rows: [], nextChunkIndex: 1 },
      { rows: [] },
      { rows: [] },
      { rows: [], nextChunkIndex: 1 },
    ];
    costPlan = { rows: [] };

    const result = await pull({ warehouseId: WAREHOUSE_ID });
    const cursor = JSON.parse(result.cursor!) as { sinceMs: number };

    // Asked about again, but only the day it could not price — not the week
    // that day was in. Surrendering the week costs the two days inside it that
    // answered perfectly well their cost figure, and later runs never look at
    // them again.
    expect(cursor.sinceMs).toBeLessThan(Date.now() - 27 * 24 * 60 * 60 * 1000);
    expect(cursor.sinceMs).toBeGreaterThan(
      Date.now() - 29 * 24 * 60 * 60 * 1000,
    );

    // And the narrower questions were actually asked: a day at most, where the
    // refused one covered a week.
    const spanOf = (body: Record<string, unknown>) => {
      const p = body.parameters as Array<{ name: string; value: string }>;
      const at = (name: string) =>
        Date.parse(p.find((x) => x.name === name)!.value);
      return at("to_ts") - at("from_ts");
    };
    expect(spanOf(statementBodies[0]!)).toBeGreaterThan(24 * 60 * 60 * 1000);
    expect(spanOf(statementBodies[1]!)).toBeLessThanOrEqual(
      24 * 60 * 60 * 1000,
    );
  });

  /** @scenario "A statement is held when an hour it ran through has no bill yet" */
  it("keeps the billed share of a piece that still owes an hour", async () => {
    // A piece can price one of a statement's hours and still owe another. The
    // hold is right — the owed hour is re-read once its bill lands — but the
    // billed share belongs to this run's record, exactly as it would had the
    // chunk priced whole. Dropping it would emit the question at nothing and
    // only correct it when billing settles, which the whole-chunk path never
    // does.
    //
    // Deep enough into the window to land in the refused first chunk, and half
    // a day off the piece boundaries so both hours sit in the same piece.
    const billedHour = usageHourOf(
      Date.now() - 29 * 24 * 60 * 60 * 1000 + 12 * 60 * 60 * 1000,
    );
    const owedHour = usageHourOf(Date.parse(billedHour) + 60 * 60 * 1000);
    costPlanQueue = [{ rows: [], nextChunkIndex: 1 }];
    costPlan = {
      rows: [
        // Half of a $6 hour, billed.
        [
          STATEMENT_ID,
          billedHour,
          "1800000",
          "3600000",
          "6.00",
          "USD",
          "PREMIUM_SERVERLESS_SQL_COMPUTE_EU_WEST",
        ],
        // And an hour whose bill has not landed: the LEFT JOIN's null SKU.
        [STATEMENT_ID, owedHour, "600000", "3600000", null, null, null],
      ],
    };

    const result = await pull({ warehouseId: WAREHOUSE_ID });
    const cursor = JSON.parse(result.cursor!) as { sinceMs: number };

    // The premise: both hours were answered by one piece-sized call, so the
    // share below was kept by the owed piece itself, not by a later chunk.
    const carrying = servedRows.filter((rows) => rows.length > 0);
    expect(carrying).toHaveLength(1);
    expect(carrying[0]).toHaveLength(2);

    // The billed hour's share survives the hold.
    expect(hintOf(result).costUsd).toBe("3");
    expect(result.events[0]?.cost_usd).toBe("3");

    // And the hold still holds: the watermark stays at the owed piece rather
    // than moving past the unbilled hour.
    expect(cursor.sinceMs).toBeLessThan(Date.now() - 28 * 24 * 60 * 60 * 1000);
    expect(cursor.sinceMs).toBeGreaterThan(
      Date.now() - 30 * 24 * 60 * 60 * 1000,
    );
  });
});
