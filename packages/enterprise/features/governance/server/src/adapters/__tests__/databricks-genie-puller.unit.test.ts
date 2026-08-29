import { PULLED_USAGE_HINT_KEY } from "@langwatch/enterprise-governance-contract";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  DatabricksGeniePuller,
  WAREHOUSE_COST_ROW_LIMIT,
} from "../databricks-genie-puller.adapter";
import {
  GovernanceHttpPort,
  type GovernanceHttpResponse,
} from "../../ports/governance-http.port";

const workspaceUrl = "https://workspace.example.test";
const warehouseId = "warehouse-1";
const spaceId = "space-1";
const conversationId = "conversation-1";
const messageId = "message-1";
const statementId = "statement-1";
const columns = [
  "statement_id",
  "usage_hour",
  "execution_ms_in_hour",
  "hour_total_ms",
  "hour_billable_usd",
  "currency_code",
  "sku_name",
];

type CostReply = {
  status?: number;
  state?: string;
  columns?: string[];
  rows?: Array<Array<string | null>>;
  nextChunkIndex?: number;
  totalRowCount?: number;
};

function response(body: unknown, status = 200): GovernanceHttpResponse {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : "failed",
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

function hour(ms: number): string {
  return new Date(Math.floor(ms / 3_600_000) * 3_600_000).toISOString();
}

class GenieWorkspace extends GovernanceHttpPort {
  readonly calls: Array<{ url: URL; init: Parameters<GovernanceHttpPort["fetch"]>[1] }> =
    [];
  readonly costRequests: Array<Record<string, unknown>> = [];
  readonly costReplies: CostReply[] = [];
  messageCreatedAt = Date.now() - 60_000;
  hasQuery = true;
  tokenResponse: GovernanceHttpResponse | null = null;

  async fetch(
    rawUrl: string,
    init: Parameters<GovernanceHttpPort["fetch"]>[1],
  ): Promise<GovernanceHttpResponse> {
    const url = new URL(rawUrl);
    this.calls.push({ url, init });

    if (url.pathname === "/api/2.0/genie/spaces") {
      return response({ spaces: [{ space_id: spaceId, title: "Revenue" }] });
    }
    if (url.pathname === "/oidc/v1/token") {
      return this.tokenResponse ?? response({ access_token: "minted-token" });
    }
    if (url.pathname === `/api/2.0/genie/spaces/${spaceId}/conversations`) {
      return response({
        conversations: [{ conversation_id: conversationId, title: "Question" }],
      });
    }
    if (
      url.pathname ===
      `/api/2.0/genie/spaces/${spaceId}/conversations/${conversationId}/messages`
    ) {
      return response({
        messages: [
          {
            message_id: messageId,
            content: "How many orders?",
            status: "COMPLETED",
            created_timestamp: this.messageCreatedAt,
            user_id: 42,
            attachments: this.hasQuery
              ? [
                  {
                    query: {
                      query: "SELECT count(*) FROM orders",
                      statement_id: statementId,
                      query_result_metadata: { row_count: 1 },
                    },
                  },
                ]
              : [{ text: { content: "Please clarify" } }],
          },
        ],
      });
    }
    if (url.pathname === "/api/2.0/preview/scim/v2/Users/42") {
      return response({
        id: "42",
        userName: "dana@example.test",
        displayName: "Dana",
        active: true,
      });
    }
    if (url.pathname === "/api/2.0/sql/statements") {
      const parsed = z
        .record(z.string(), z.unknown())
        .parse(JSON.parse(init.body ?? "{}"));
      this.costRequests.push(parsed);
      const plan = this.costReplies.shift() ?? {};
      if (plan.status) return response({ message: "denied" }, plan.status);
      return response({
        status: { state: plan.state ?? "SUCCEEDED" },
        manifest: {
          schema: { columns: (plan.columns ?? columns).map((name) => ({ name })) },
          ...(plan.totalRowCount === undefined
            ? {}
            : { total_row_count: plan.totalRowCount }),
        },
        result: {
          data_array: plan.rows ?? [],
          ...(plan.nextChunkIndex === undefined
            ? {}
            : { next_chunk_index: plan.nextChunkIndex }),
        },
      });
    }
    return response({ message: `unrouted ${url.pathname}` }, 404);
  }
}

function config(overrides: Record<string, unknown> = {}) {
  return {
    adapter: "databricks_genie",
    workspaceUrl,
    spaceIds: [],
    schedule: "*/15 * * * *",
    ...overrides,
  };
}

function run(
  workspace: GenieWorkspace,
  overrides: Record<string, unknown> = {},
  cursor: string | null = null,
  credentials: Record<string, string> = { token: "dapi-token" },
) {
  const adapter = DatabricksGeniePuller.create(workspace);
  return adapter.runOnce(
    { cursor, credentials },
    adapter.validateConfig(config(overrides)),
  );
}

function hint(result: { events: Array<{ extra?: Record<string, unknown> }> }) {
  return z
    .object({
      costBasis: z.string(),
      costStatus: z.string(),
      costUsd: z.string(),
      dimensions: z.record(z.string(), z.string()),
    })
    .parse(result.events[0]?.extra?.[PULLED_USAGE_HINT_KEY]);
}

describe("Databricks Genie puller", () => {
  it("records questions with no warehouse without reading billing", async () => {
    const workspace = new GenieWorkspace();

    const result = await run(workspace);

    expect(result.events).toHaveLength(1);
    expect(result.events[0]).toMatchObject({
      source_event_id: expect.stringContaining(messageId),
      actor: "dana@example.test",
      cost_usd: "0",
    });
    expect(hint(result)).toMatchObject({ costStatus: "estimate", costUsd: "0" });
    expect(workspace.costRequests).toEqual([]);
  });

  it("uses service-principal credentials and include_all when walking a workspace", async () => {
    const workspace = new GenieWorkspace();

    await run(workspace, {}, null, { clientId: "client", clientSecret: "secret" });

    const tokenCall = workspace.calls.find(
      (call) => call.url.pathname === "/oidc/v1/token",
    );
    const spaceCall = workspace.calls.find((call) =>
      call.url.pathname.endsWith("/conversations"),
    );
    expect(tokenCall?.init).toMatchObject({
      method: "POST",
      headers: { authorization: "Basic Y2xpZW50OnNlY3JldA==" },
      body: "grant_type=client_credentials&scope=all-apis",
    });
    expect(spaceCall?.url.searchParams.get("include_all")).toBe("true");
    expect(spaceCall?.init.headers).toMatchObject({
      Authorization: "Bearer minted-token",
    });
  });

  it("redacts a refused service-principal sign-in", async () => {
    const workspace = new GenieWorkspace();
    workspace.tokenResponse = response({ detail: "secret=should-not-escape" }, 401);

    await expect(
      run(workspace, {}, null, { clientId: "client", clientSecret: "secret" }),
    ).rejects.toThrow("HTTP 401");
    await expect(
      run(workspace, {}, null, { clientId: "client", clientSecret: "secret" }),
    ).rejects.not.toThrow("should-not-escape");
  });

  it("runs a whole-hour billing query on the configured warehouse and retains its cost", async () => {
    const workspace = new GenieWorkspace();
    workspace.costReplies.push({
      rows: [[statementId, hour(Date.now()), "1000", "2000", "6", "USD", "SKU"]],
    });

    const result = await run(workspace, { warehouseId });
    const request = workspace.costRequests[0]!;
    const parameters = z
      .array(z.object({ name: z.string(), value: z.string() }))
      .parse(request.parameters);

    expect(request).toMatchObject({
      warehouse_id: warehouseId,
      wait_timeout: "50s",
      on_wait_timeout: "CANCEL",
      format: "JSON_ARRAY",
      disposition: "INLINE",
    });
    expect(String(request.statement)).toContain("genie_space_id");
    expect(String(request.statement)).toContain("client_application = :genie_app");
    expect(String(request.statement)).not.toContain("warehouse_id = :warehouse_id");
    expect(parameters.find((parameter) => parameter.name === "from_ts")?.value).toMatch(
      /:00:00.000Z$/,
    );
    expect(hint(result)).toMatchObject({ costUsd: "3", costStatus: "estimate" });
  });

  it.each([
    ["missing manifest columns", { columns: ["wrong"] }],
    ["reordered manifest columns", { columns: [...columns].reverse() }],
    ["a continuation token", { nextChunkIndex: 1 }],
    ["a truncated manifest count", { totalRowCount: 1 }],
    [
      "the configured row limit",
      {
        rows: Array.from({ length: WAREHOUSE_COST_ROW_LIMIT }, () => [
          statementId,
          hour(Date.now()),
          "1",
          "1",
          "1",
          "USD",
          "SKU",
        ]),
      },
    ],
  ])("does not price an untrustworthy billing answer: %s", async (_reason, plan) => {
    const workspace = new GenieWorkspace();
    workspace.costReplies.push(plan);

    const result = await run(workspace, { warehouseId });

    expect(result.events).toHaveLength(1);
    expect(hint(result).costUsd).toBe("0");
  });

  it("holds the watermark for a cut-short billing period rather than skipping it", async () => {
    const workspace = new GenieWorkspace();
    workspace.costReplies.push({ nextChunkIndex: 1 }, { nextChunkIndex: 1 });

    const result = await run(workspace, { warehouseId });
    const cursor = z
      .object({ sinceMs: z.number(), sweepHadGap: z.boolean() })
      .parse(JSON.parse(result.cursor ?? "{}"));

    expect(result.events).toHaveLength(1);
    expect(cursor.sweepHadGap).toBe(false);
    expect(cursor.sinceMs).toBeLessThan(Date.now() - 29 * 24 * 3_600_000);
    expect(workspace.costRequests).toHaveLength(2);

    const firstWindow = z
      .array(z.object({ name: z.string(), value: z.string() }))
      .parse(workspace.costRequests[0]?.parameters)
      .find((parameter) => parameter.name === "from_ts")?.value;
    workspace.costReplies.push({
      rows: [[statementId, hour(Date.now()), "1000", "1000", "6", "USD", "SKU"]],
    });
    const repaired = await run(workspace, { warehouseId }, result.cursor);
    const repairedWindow = z
      .array(z.object({ name: z.string(), value: z.string() }))
      .parse(workspace.costRequests[2]?.parameters)
      .find((parameter) => parameter.name === "from_ts")?.value;

    expect(repairedWindow).toBe(firstWindow);
    expect(hint(repaired).costUsd).toBe("6");
  });

  it("keeps a question without SQL and never invents a statement cost", async () => {
    const workspace = new GenieWorkspace();
    workspace.hasQuery = false;
    workspace.costReplies.push({
      rows: [[statementId, hour(Date.now()), "1000", "1000", "6", "USD", "SKU"]],
    });

    const result = await run(workspace, { warehouseId });

    expect(result.events).toHaveLength(1);
    expect(hint(result).costUsd).toBe("0");
  });
});
