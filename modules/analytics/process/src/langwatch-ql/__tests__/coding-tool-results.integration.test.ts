/**
 * @vitest-environment node
 * The `coding_tool_results` view over the shipped fact tables: a tool-call span
 * joined to the request body the next turn captured, read as one query.
 * @see specs/lwql/coding-agent-views.feature
 */
import type { ClickHouseClient } from "@clickhouse/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { LWQL_VIEW_CATALOG } from "../../rules/lwql-view-catalog.rules.ts";
import { LangWatchQLViewProvisioningService } from "../../services/langwatch-ql-view-provisioning.service.ts";
import { SHIPPED_LWQL_DEDUP } from "../../services/langwatch-ql-view-statements.service.ts";
import {
  type LangWatchQLClickHouseHarness,
  type LangWatchQLPostgresHarness,
  mapPostgresIntoClickHouse,
  selectRows,
  startLangWatchQLClickHouse,
  startLangWatchQLPostgres,
} from "./lwql-clickhouse-harness.ts";

const viewProvisioning = LangWatchQLViewProvisioningService.create();

const SESSION_ID = "coding-session-1";
const STRING_RESULT = "total 8\ndrwxr-xr-x  2 user user 4096 src";
const BLOCK_RESULT_PARTS = ["first block. ", "second block."];

interface ToolResultRow {
  ToolUseId: string;
  ToolName: string;
  Success: number | null;
  SessionId: string;
  OutputText: string;
}

/** What the agent sent on its next turn: the tool results it carried back. */
function requestBody(results: { toolUseId: string; content: unknown }[]): string {
  return JSON.stringify({
    messages: [
      { role: "user", content: "run the tools" },
      {
        role: "user",
        content: results.map(({ toolUseId, content }) => ({
          type: "tool_result",
          tool_use_id: toolUseId,
          content,
        })),
      },
    ],
  });
}

describe("given the coding_tool_results view provisioned over the shipped fact tables", () => {
  let harness: LangWatchQLClickHouseHarness;
  let postgres: LangWatchQLPostgresHarness;
  let tenantA: ClickHouseClient;
  let database: string;

  beforeAll(async () => {
    postgres = await startLangWatchQLPostgres();
    harness = await startLangWatchQLClickHouse({
      suite: "coding-tool-results",
      facts: "migrated",
    });
    database = harness.names.database;
    const facts = harness.factDatabase;
    const now = new Date().toISOString().slice(0, 23).replace("T", " ");

    const toolSpan = ({
      tenantId,
      traceId,
      spanId,
      toolUseId,
      toolName,
      statusCode,
    }: {
      tenantId: string;
      traceId: string;
      spanId: string;
      toolUseId: string;
      toolName: string;
      statusCode: number;
    }) => ({
      ProjectionId: `${tenantId}/${spanId}`,
      TenantId: tenantId,
      TraceId: traceId,
      SpanId: spanId,
      Sampled: 1,
      StartTime: now,
      EndTime: now,
      SpanName: "claude_code.tool",
      ServiceName: "claude-code",
      StatusCode: statusCode,
      SpanAttributes: { tool_use_id: toolUseId, tool_name: toolName },
    });
    const capturedBody = ({
      tenantId,
      traceId,
      body,
    }: {
      tenantId: string;
      traceId: string;
      body: string;
    }) => ({
      TenantId: tenantId,
      RecordId: `${tenantId}-${traceId}`.padEnd(64, "0"),
      CorrelationTraceId: traceId,
      TimeUnixMs: now,
      EventName: "api_request_body",
      ProviderSessionId: SESSION_ID,
      AttributesJson: JSON.stringify({ body }),
    });

    const a = harness.tenantA.tenantId;
    const b = harness.tenantB.tenantId;
    await harness.admin.insert({
      table: `${facts}.stored_spans`,
      format: "JSONEachRow",
      values: [
        toolSpan({
          tenantId: a,
          traceId: "trace-a",
          spanId: "span-string",
          toolUseId: "toolu_string",
          toolName: "Bash",
          statusCode: 1,
        }),
        toolSpan({
          tenantId: a,
          traceId: "trace-a",
          spanId: "span-blocks",
          toolUseId: "toolu_blocks",
          toolName: "Read",
          statusCode: 2,
        }),
        toolSpan({
          tenantId: a,
          traceId: "trace-uncaptured",
          spanId: "span-uncaptured",
          toolUseId: "toolu_uncaptured",
          toolName: "Grep",
          statusCode: 1,
        }),
        toolSpan({
          tenantId: b,
          traceId: "trace-a",
          spanId: "span-other-tenant",
          toolUseId: "toolu_string",
          toolName: "Bash",
          statusCode: 1,
        }),
      ],
    });
    await harness.admin.insert({
      table: `${facts}.log_records`,
      format: "JSONEachRow",
      values: [
        capturedBody({
          tenantId: a,
          traceId: "trace-a",
          body: requestBody([
            { toolUseId: "toolu_string", content: STRING_RESULT },
            {
              toolUseId: "toolu_blocks",
              content: BLOCK_RESULT_PARTS.map((text) => ({ type: "text", text })),
            },
          ]),
        }),
        capturedBody({
          tenantId: b,
          traceId: "trace-a",
          body: requestBody([
            { toolUseId: "toolu_string", content: "OTHER-TENANT-OUTPUT-do-not-leak" },
          ]),
        }),
      ],
    });

    await mapPostgresIntoClickHouse({ harness, postgres });
    await harness.applyAsAdmin(
      viewProvisioning.setupStatements({
        names: harness.names,
        sourceDatabase: facts,
        dedup: SHIPPED_LWQL_DEDUP,
      }),
    );
    await harness.applyAccessModel({ views: LWQL_VIEW_CATALOG, sourceDatabase: facts });
    tenantA = await harness.restrictedClient({ keyHash: harness.tenantA.keyHash });
  }, 600_000);

  afterAll(async () => {
    await harness?.stop();
    await postgres?.stop();
  });

  describe("when a user reads what the tool calls of a session printed", () => {
    /** @scenario "Read what a tool call printed" */
    it("returns each call's printed text beside its tool and outcome, from one query", async () => {
      const rows = await selectRows<ToolResultRow>(
        tenantA,
        `SELECT ToolUseId, ToolName, Success, SessionId, OutputText ` +
          `FROM ${database}.coding_tool_results ORDER BY ToolUseId`,
      );

      expect(rows).toEqual([
        {
          ToolUseId: "toolu_blocks",
          ToolName: "Read",
          Success: 0,
          SessionId: SESSION_ID,
          OutputText: BLOCK_RESULT_PARTS.join(""),
        },
        {
          ToolUseId: "toolu_string",
          ToolName: "Bash",
          Success: 1,
          SessionId: SESSION_ID,
          OutputText: STRING_RESULT,
        },
        {
          ToolUseId: "toolu_uncaptured",
          ToolName: "Grep",
          Success: 1,
          SessionId: "",
          OutputText: "",
        },
      ]);
    });

    /** @scenario "Read what a tool call printed" */
    it("never joins a request body captured for another project", async () => {
      const rows = await selectRows<{ OutputText: string }>(
        tenantA,
        `SELECT OutputText FROM ${database}.coding_tool_results`,
      );

      expect(JSON.stringify(rows)).not.toContain("OTHER-TENANT-OUTPUT");
    });
  });
});
