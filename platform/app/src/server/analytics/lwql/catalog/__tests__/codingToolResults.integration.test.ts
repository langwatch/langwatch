/**
 * Proof for the hand-written `coding_tool_results` joined view (#8085 /
 * #8116 Part B, steps 3 and 5): `stored_spans` LEFT-joined to `log_records`,
 * over the *shipped* migrations rather than a toy fixture, since neither
 * table exists in the fixture schema — same `facts: "migrated"` mode
 * `tenantIsolation.integration.test.ts`'s coding-agent suite and
 * `catalogStatements.integration.test.ts` use.
 *
 * Four things are proved, against a real ClickHouse 25.10 server:
 *
 *  - the join finds the right `tool_result` block by `tool_use_id` and
 *    returns its literal text, ignoring an unrelated `tool_result` in the
 *    same request body;
 *  - a `LEFT` join (not `INNER`) is load-bearing: a tool-call span with no
 *    captured request body still returns a row, with `OutputText = ''`,
 *    rather than disappearing from the dataset;
 *  - the row policy covers both physical tables at once — a key for another
 *    project sees none of it;
 *  - the join does not force a full scan of `log_records`: a query scoped to
 *    one trace's recent window reads far fewer rows than one with no such
 *    scope, per the server's own `system.query_log` accounting.
 *
 * @see specs/lwql/coding-agent-datasets.feature
 */
import type { ClickHouseClient } from "@clickhouse/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  type LangWatchQLClickHouseHarness,
  measureQuery,
  selectRows,
  selectScalar,
  startLangWatchQLClickHouse,
} from "../../__tests__/lwqlClickHouseHarness";
import {
  lwqlViewSetupStatements,
  SHIPPED_LWQL_DEDUP,
} from "../../provisioning/catalogStatements";
import { CODING_TOOL_RESULTS } from "../overrides/coding";

/** `now` minus `weeksAgo` whole weeks, as a ClickHouse-parseable timestamp. */
function weeksAgo(weeksAgoCount: number): string {
  const ms = Date.now() - weeksAgoCount * 7 * 24 * 60 * 60 * 1000;
  return new Date(ms).toISOString().replace("T", " ").replace("Z", "");
}

/** A minimal `stored_spans` row: everything the view's columns read, plus the columns the table requires. */
function toolSpanRow({
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
}) {
  return {
    ProjectionId: `${tenantId}/${spanId}`,
    TenantId: tenantId,
    TraceId: traceId,
    SpanId: spanId,
    Sampled: 1,
    StartTime: weeksAgo(0),
    EndTime: weeksAgo(0),
    DurationMs: 42,
    SpanName: "claude_code.tool",
    SpanKind: 1,
    ServiceName: "coding-agent",
    ScopeName: "langwatch",
    ResourceAttributes: {},
    SpanAttributes: { tool_use_id: toolUseId, tool_name: toolName },
    StatusCode: statusCode,
  };
}

/** A minimal `log_records` row for an `api_request_body` event. */
function requestBodyLogRow({
  tenantId,
  traceId,
  sessionId,
  body,
  occurredAt,
}: {
  tenantId: string;
  traceId: string;
  sessionId: string;
  body: string;
  occurredAt: string;
}) {
  return {
    TenantId: tenantId,
    RecordId: `${tenantId}-${traceId}`.padEnd(64, "0"),
    ResourceSchemaUrl: "",
    ResourceAttributesJson: "{}",
    ResourceAttributesFlatJson: "{}",
    ScopeSchemaUrl: "",
    ScopeName: "langwatch",
    ScopeVersion: "1.0.0",
    ScopeAttributesJson: "{}",
    WireTraceId: traceId,
    WireSpanId: "",
    CorrelationTraceId: traceId,
    CorrelationSpanId: "",
    CorrelationSource: "coding_agent",
    TimeUnixNano: 0,
    ObservedTimeUnixNano: 0,
    TimeUnixMs: occurredAt,
    SeverityNumber: 9,
    SeverityText: "INFO",
    BodyType: "json",
    BodyJson: "{}",
    AttributesJson: JSON.stringify({ body }),
    AttributesFlatJson: "{}",
    Flags: 0,
    EventName: "api_request_body",
    ProviderKind: "anthropic",
    ProviderEventKind: "request",
    ProviderEventSequence: "0",
    ProviderSessionId: sessionId,
    ProviderConversationId: "",
    ProviderPromptId: "",
    PiiRedactionLevel: "none",
    CanonicalPayload: "{}",
    OccurredAt: occurredAt,
    AcceptedAt: occurredAt,
    DedupVersion: 1,
  };
}

/** A `messages[].content[]` shaped body carrying two `tool_result` blocks. */
function toolResultBody({
  targetToolUseId,
  targetText,
}: {
  targetToolUseId: string;
  targetText: string;
}): string {
  return JSON.stringify({
    messages: [
      { role: "user", content: "run the command" },
      {
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: "unrelated-tool-use",
            content: "unrelated output",
          },
          {
            type: "tool_result",
            tool_use_id: targetToolUseId,
            content: targetText,
          },
        ],
      },
    ],
  });
}

describe("given coding_tool_results provisioned over the shipped migrations (#8085)", () => {
  let harness: LangWatchQLClickHouseHarness;
  let tenantA: ClickHouseClient;
  let tenantB: ClickHouseClient;
  let database: string;
  let facts: string;

  const traceWithBody = "coding-tool-trace-with-body";
  const traceWithoutBody = "coding-tool-trace-without-body";
  const traceForTenantB = "coding-tool-trace-tenant-b";
  const targetToolUseId = "toolu_target";
  const targetOutputText = "bash: foo: command not found";
  const sessionId = "session-coding-tool-results";

  beforeAll(async () => {
    harness = await startLangWatchQLClickHouse({
      suite: "codingtoolresults",
      facts: "migrated",
    });
    database = harness.names.database;
    facts = harness.factDatabase;

    await harness.applyAsAdmin(
      lwqlViewSetupStatements({
        names: harness.names,
        sourceDatabase: facts,
        views: [CODING_TOOL_RESULTS],
        dedup: SHIPPED_LWQL_DEDUP,
      }),
    );

    await harness.admin.insert({
      table: `${facts}.stored_spans`,
      format: "JSONEachRow",
      values: [
        toolSpanRow({
          tenantId: harness.tenantA.tenantId,
          traceId: traceWithBody,
          spanId: "span-with-body",
          toolUseId: targetToolUseId,
          toolName: "Bash",
          statusCode: 2, // OTel STATUS_CODE_ERROR — the tool call failed.
        }),
        toolSpanRow({
          tenantId: harness.tenantA.tenantId,
          traceId: traceWithoutBody,
          spanId: "span-without-body",
          toolUseId: "toolu_no_body",
          toolName: "Bash",
          statusCode: 1,
        }),
        toolSpanRow({
          tenantId: harness.tenantB.tenantId,
          traceId: traceForTenantB,
          spanId: "span-tenant-b",
          toolUseId: "toolu_tenant_b",
          toolName: "Bash",
          statusCode: 1,
        }),
      ],
    });

    await harness.admin.insert({
      table: `${facts}.log_records`,
      format: "JSONEachRow",
      values: [
        requestBodyLogRow({
          tenantId: harness.tenantA.tenantId,
          traceId: traceWithBody,
          sessionId,
          body: toolResultBody({
            targetToolUseId,
            targetText: targetOutputText,
          }),
          occurredAt: weeksAgo(0),
        }),
        // Noise: request bodies for other traces, spread across old weeks so a
        // recent-window query partition-prunes them away (log_records is
        // `PARTITION BY toYearWeek(TimeUnixMs)`). None carry `traceWithBody`,
        // so they can never match the join and exist only to make "reads only
        // the seeded rows for the trace" a claim about something, not a
        // vacuous pass against a near-empty table.
        ...[1, 2, 3, 4, 5, 6].flatMap((weekIndex) =>
          Array.from({ length: 100 }, (_, i) =>
            requestBodyLogRow({
              tenantId: harness.tenantA.tenantId,
              traceId: `noise-trace-${weekIndex}-${i}`,
              sessionId: `noise-session-${weekIndex}-${i}`,
              body: toolResultBody({
                targetToolUseId: `noise-tool-use-${weekIndex}-${i}`,
                targetText: "noise",
              }),
              occurredAt: weeksAgo(weekIndex),
            }),
          ),
        ),
      ],
    });

    tenantA = await harness.restrictedClient({
      keyHash: harness.tenantA.keyHash,
    });
    tenantB = await harness.restrictedClient({
      keyHash: harness.tenantB.keyHash,
    });
  }, 180_000);

  afterAll(async () => {
    await harness?.stop();
  });

  describe("when a tool call's request body was captured", () => {
    /** @scenario "Read what a tool call printed" */
    it("returns the matching tool_result block's text, not the unrelated one in the same body", async () => {
      const rows = await selectRows<{
        ToolUseId: string;
        OutputText: string;
        Success: number;
      }>(
        tenantA,
        `SELECT ToolUseId, OutputText, Success FROM ${database}.coding_tool_results ` +
          `WHERE TraceId = '${traceWithBody}'`,
      );

      expect(rows).toHaveLength(1);
      expect(rows[0]!.ToolUseId).toBe(targetToolUseId);
      expect(rows[0]!.OutputText).toBe(targetOutputText);
      // StatusCode 2 (OTel error) fed into `!= 2`: 0 (false).
      expect(Number(rows[0]!.Success)).toBe(0);
    });
  });

  describe("when a tool call's request body was never captured", () => {
    /** @scenario "Read what a tool call printed" */
    it("returns the row with an empty OutputText rather than dropping it — the LEFT join is load-bearing", async () => {
      const rows = await selectRows<{ ToolUseId: string; OutputText: string }>(
        tenantA,
        `SELECT ToolUseId, OutputText FROM ${database}.coding_tool_results ` +
          `WHERE TraceId = '${traceWithoutBody}'`,
      );

      expect(
        rows,
        "no row at all means the LEFT join fell back to an INNER join somewhere",
      ).toHaveLength(1);
      expect(rows[0]!.OutputText).toBe("");
    });
  });

  describe("when a key for another project reads the view", () => {
    it("sees none of tenant A's tool-call rows", async () => {
      const control = await selectScalar<string>(
        harness.admin,
        `SELECT count() AS value FROM ${facts}.stored_spans ` +
          `WHERE TenantId = '${harness.tenantA.tenantId}' AND TraceId = '${traceWithBody}'`,
      );
      expect(
        Number(control),
        "control: tenant A's row must exist, or the zero-rows assertion below is vacuous",
      ).toBeGreaterThan(0);

      const rows = await selectRows(
        tenantB,
        `SELECT ToolUseId FROM ${database}.coding_tool_results WHERE TraceId = '${traceWithBody}'`,
      );
      expect(rows).toHaveLength(0);

      // And the reverse: tenant A never sees tenant B's row either.
      const reverse = await selectRows(
        tenantA,
        `SELECT ToolUseId FROM ${database}.coding_tool_results WHERE TraceId = '${traceForTenantB}'`,
      );
      expect(reverse).toHaveLength(0);
    });
  });

  describe("when the query scopes to one trace's recent window", () => {
    /** @scenario "Read what a tool call printed" */
    it("reads far fewer rows than a query with no such scope, per system.query_log", async () => {
      const cutoff = weeksAgo(0.5);
      const scoped = await measureQuery({
        harness,
        client: tenantA,
        query:
          `SELECT ToolUseId, OutputText FROM ${database}.coding_tool_results ` +
          `WHERE TraceId = '${traceWithBody}' AND CapturedAt >= toDateTime64('${cutoff}', 3)`,
      });
      const unscoped = await measureQuery({
        harness,
        client: tenantA,
        query: `SELECT count() AS value FROM ${database}.coding_tool_results`,
      });

      // Not a bound on the absolute number (that would pin the fixture's
      // size), a comparison: the scoped read is a small fraction of the
      // unscoped one, which is what proves the trace/time predicate reached
      // the physical read rather than filtering after a full scan.
      expect(
        scoped.rowsRead,
        `scoped read (${scoped.rowsRead} rows) did not prune against the ` +
          `unscoped read (${unscoped.rowsRead} rows) — the predicate is not reaching the scan`,
      ).toBeLessThan(unscoped.rowsRead / 2);
    });
  });
});
