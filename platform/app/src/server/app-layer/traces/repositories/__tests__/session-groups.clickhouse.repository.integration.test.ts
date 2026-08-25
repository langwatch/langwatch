/**
 * @vitest-environment node
 * @integration
 *
 * Runs the Sessions lens rollup (specs/traces-v2/sessions-lens.feature)
 * against real ClickHouse: GROUP BY conversation id over `trace_summaries`
 * with IN-tuple dedup, transcript content search through `log_records`, and
 * the keyset pagination the lens pages with. Log rows are written through
 * the production canonicalisation path so the fixture shape cannot drift
 * from what ingest actually stores.
 */
import type { ClickHouseClient } from "@clickhouse/client";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  type LogRedactionService,
  prepareCanonicalLogRecords,
} from "~/server/event-sourcing/pipelines/log-processing/canonicalLog";
import {
  startTestContainers,
  stopTestContainers,
} from "../../../../event-sourcing/__tests__/integration/testContainers";
import { CanonicalLogRecordClickHouseRepository } from "../../../logs/repositories/canonical-log-record.clickhouse.repository";
import { SessionGroupsClickHouseRepository } from "../session-groups.clickhouse.repository";
import type { SessionGroupsQuery } from "../session-groups.repository";

let ch: ClickHouseClient;
let repository: SessionGroupsClickHouseRepository;

const tag = nanoid();
const tenantId = `${tag}-project`;
const baseMs = Date.now();
const timeRange = {
  from: baseMs - 60 * 60 * 1000,
  to: baseMs + 60 * 60 * 1000,
};

const SESSION_ALPHA = `${tag}-sess-alpha`;
const SESSION_BETA = `${tag}-sess-beta`;

function traceSummaryRow(overrides: Record<string, unknown> = {}) {
  return {
    ProjectionId: `proj-${nanoid()}`,
    TenantId: tenantId,
    TraceId: `trace-${nanoid()}`,
    Version: "v1",
    Attributes: {},
    OccurredAt: new Date(baseMs),
    CreatedAt: new Date(baseMs),
    UpdatedAt: new Date(baseMs),
    ComputedIOSchemaVersion: "v1",
    ComputedInput: null,
    ComputedOutput: null,
    TimeToFirstTokenMs: null,
    TimeToLastTokenMs: null,
    TotalDurationMs: 100,
    TokensPerSecond: null,
    SpanCount: 1,
    ContainsErrorStatus: false,
    ContainsOKStatus: true,
    ErrorMessage: null,
    Models: [],
    TotalCost: null,
    TokensEstimated: false,
    TotalPromptTokenCount: null,
    TotalCompletionTokenCount: null,
    OutputFromRootSpan: false,
    OutputSpanEndTimeMs: 0,
    BlockedByGuardrail: false,
    SatisfactionScore: null,
    TopicId: null,
    SubTopicId: null,
    HasAnnotation: null,
    ...overrides,
  };
}

function sessionTrace({
  sessionId,
  traceId,
  occurredAtMs,
  cost,
  promptTokens,
  completionTokens,
  cacheReadTokens,
  contextSizeTokens,
  durationMs,
  model,
  updatedAtMs,
  computedInput,
}: {
  sessionId: string;
  traceId: string;
  occurredAtMs: number;
  cost: number;
  promptTokens: number;
  completionTokens: number;
  cacheReadTokens?: number;
  contextSizeTokens?: number;
  durationMs?: number;
  model?: string;
  updatedAtMs?: number;
  computedInput?: string;
}) {
  return traceSummaryRow({
    TraceId: traceId,
    Attributes: {
      "gen_ai.conversation.id": sessionId,
      "service.name": "coding-agent-cli",
      ...(cacheReadTokens !== undefined
        ? { "langwatch.reserved.cache_read_tokens": String(cacheReadTokens) }
        : {}),
      ...(contextSizeTokens !== undefined
        ? {
            "langwatch.reserved.context_size_tokens": String(contextSizeTokens),
          }
        : {}),
    },
    OccurredAt: new Date(occurredAtMs),
    UpdatedAt: new Date(updatedAtMs ?? occurredAtMs),
    TotalCost: cost,
    TotalPromptTokenCount: promptTokens,
    TotalCompletionTokenCount: completionTokens,
    TotalDurationMs: durationMs ?? 1000,
    Models: model ? [model] : [],
    ComputedInput: computedInput ?? null,
  });
}

async function insertTraceSummaries(rows: Record<string, unknown>[]) {
  await ch.insert({
    table: "trace_summaries",
    values: rows,
    format: "JSONEachRow",
    clickhouse_settings: { async_insert: 0, wait_for_async_insert: 0 },
  });
}

const noRedaction: LogRedactionService = {
  redactLog: async () => undefined,
};

/** One transcript log record for a session, through the production canonicaliser. */
async function insertSessionLog({
  sessionId,
  body,
  timeMs,
}: {
  sessionId: string;
  body: string;
  timeMs: number;
}) {
  const result = await prepareCanonicalLogRecords({
    tenantId,
    organizationId: `${tag}-org`,
    piiRedactionLevel: "DISABLED",
    redactionService: noRedaction,
    acceptedAt: timeMs,
    request: {
      resourceLogs: [
        {
          resource: {
            attributes: [{ key: "service.name", value: { stringValue: "claude-code" } }],
          },
          scopeLogs: [
            {
              scope: {
                name: "com.anthropic.claude_code.events",
                version: "1.0.0",
              },
              logRecords: [
                {
                  traceId: "a1b2c3d4e5f60718a1b2c3d4e5f60718",
                  spanId: "1111aaaa2222bbbb",
                  timeUnixNano: (BigInt(timeMs) * 1_000_000n).toString(),
                  severityNumber: 9,
                  severityText: "INFO",
                  body: { stringValue: body },
                  attributes: [
                    {
                      key: "event.name",
                      value: { stringValue: "user_prompt" },
                    },
                    { key: "session.id", value: { stringValue: sessionId } },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
  });
  if (result.errors.length > 0) {
    throw new Error(
      `Canonicalising the fixture log failed: ${JSON.stringify(result.errors)}`,
    );
  }
  const logRepo = new CanonicalLogRecordClickHouseRepository(async () => ch);
  await logRepo.ensureLogRecords(result.accepted.map((prepared) => prepared.record));
}

function query(overrides: Partial<SessionGroupsQuery> = {}): SessionGroupsQuery {
  return {
    tenantId,
    timeRange,
    sort: { column: "lastActivity", direction: "desc" },
    limit: 50,
    ...overrides,
  };
}

beforeAll(async () => {
  const containers = await startTestContainers();
  ch = containers.clickHouseClient;
  repository = new SessionGroupsClickHouseRepository(async () => ch);

  await insertTraceSummaries([
    // Session alpha: three traces whose rollup the small-page read must
    // still sum in full.
    sessionTrace({
      sessionId: SESSION_ALPHA,
      traceId: `${tag}-alpha-1`,
      occurredAtMs: baseMs - 300_000,
      cost: 1,
      promptTokens: 100,
      completionTokens: 50,
      cacheReadTokens: 10_000,
      contextSizeTokens: 50_000,
      durationMs: 1000,
      model: "claude-sonnet-4",
    }),
    sessionTrace({
      sessionId: SESSION_ALPHA,
      traceId: `${tag}-alpha-2`,
      occurredAtMs: baseMs - 200_000,
      cost: 2,
      promptTokens: 200,
      completionTokens: 100,
      cacheReadTokens: 20_000,
      contextSizeTokens: 80_000,
      durationMs: 2000,
      model: "claude-sonnet-4",
    }),
    sessionTrace({
      sessionId: SESSION_ALPHA,
      traceId: `${tag}-alpha-3`,
      occurredAtMs: baseMs - 100_000,
      cost: 3,
      promptTokens: 300,
      completionTokens: 150,
      cacheReadTokens: 30_000,
      contextSizeTokens: 60_000,
      durationMs: 3000,
      model: "claude-haiku-4",
      computedInput: "latest alpha prompt",
    }),
    // Session beta: two traces.
    sessionTrace({
      sessionId: SESSION_BETA,
      traceId: `${tag}-beta-1`,
      occurredAtMs: baseMs - 250_000,
      cost: 5,
      promptTokens: 500,
      completionTokens: 250,
    }),
    sessionTrace({
      sessionId: SESSION_BETA,
      traceId: `${tag}-beta-2`,
      occurredAtMs: baseMs - 50_000,
      cost: 7,
      promptTokens: 700,
      completionTokens: 350,
    }),
    // A trace with no conversation id never forms a session row.
    traceSummaryRow({
      TraceId: `${tag}-loose`,
      OccurredAt: new Date(baseMs - 10_000),
      TotalCost: 100,
    }),
  ]);

  await insertSessionLog({
    sessionId: SESSION_ALPHA,
    body: `replicated the rollup tables, closes #6418 for good`,
    timeMs: baseMs - 150_000,
  });
  await insertSessionLog({
    sessionId: SESSION_BETA,
    body: "unrelated transcript content about compaction pauses",
    timeMs: baseMs - 40_000,
  });
}, 120_000);

afterAll(async () => {
  if (ch) {
    await ch.exec({
      query: `ALTER TABLE trace_summaries DELETE WHERE TenantId = {tenantId:String}`,
      query_params: { tenantId },
    });
    await ch.exec({
      query: `ALTER TABLE log_records DELETE WHERE TenantId = {tenantId:String}`,
      query_params: { tenantId },
    });
    await ch.exec({
      query: `ALTER TABLE log_usage_estimates DELETE WHERE TenantId = {tenantId:String}`,
      query_params: { tenantId },
    });
  }
  await stopTestContainers();
});

describe("SessionGroupsClickHouseRepository", () => {
  describe("given two sessions with several traces each", () => {
    /** @scenario Session rollups sum every trace in the range, not one page */
    it("sums every trace of a session even when the page holds one session", async () => {
      const page = await repository.findSessionGroups(query({ limit: 1 }));

      // Beta is most recent (baseMs - 50s) and must carry BOTH its traces
      // even though the page fits a single session row.
      expect(page.rows).toHaveLength(1);
      const beta = page.rows[0]!;
      expect(beta.conversationId).toBe(SESSION_BETA);
      expect(beta.traceCount).toBe(2);
      expect(beta.totalCost).toBeCloseTo(12);
      expect(beta.totalTokens).toBe(1800);
      expect(page.totalHits).toBe(2);

      const full = await repository.findSessionGroups(query());
      const alpha = full.rows.find((row) => row.conversationId === SESSION_ALPHA)!;
      expect(alpha.traceCount).toBe(3);
      expect(alpha.totalCost).toBeCloseTo(6);
      expect(alpha.totalTokens).toBe(900);
      expect(alpha.cacheReadTokens).toBe(60_000);
      expect(alpha.contextSizeTokens).toBe(80_000);
      expect(alpha.totalDurationMs).toBeCloseTo(6000);
      expect(alpha.startedAtMs).toBe(baseMs - 300_000);
      expect(alpha.lastActivityMs).toBe(baseMs - 100_000);
      expect([...alpha.models].sort()).toEqual(["claude-haiku-4", "claude-sonnet-4"]);
      expect(alpha.serviceName).toBe("coding-agent-cli");
      expect(alpha.input).toBe("latest alpha prompt");
    });
  });

  describe("given a session whose traces were captured at different times", () => {
    /** @scenario The rollup names each session's most recent trace */
    it("names the latest trace of every session row", async () => {
      const page = await repository.findSessionGroups(query());

      const alpha = page.rows.find((row) => row.conversationId === SESSION_ALPHA)!;
      const beta = page.rows.find((row) => row.conversationId === SESSION_BETA)!;

      // Alpha's newest trace is the one at baseMs - 100s, beta's at
      // baseMs - 50s: the id has to follow the last activity, not insert order.
      expect(alpha.lastTraceId).toBe(`${tag}-alpha-3`);
      expect(beta.lastTraceId).toBe(`${tag}-beta-2`);
    });
  });

  describe("given a trace summary re-projected with a newer version", () => {
    /** @scenario A re-projected trace is only counted once in its session rollup */
    it("counts the latest version only", async () => {
      const sessionId = `${tag}-sess-reproj`;
      const traceId = `${tag}-reproj-1`;
      await insertTraceSummaries([
        sessionTrace({
          sessionId,
          traceId,
          occurredAtMs: baseMs - 20_000,
          cost: 99,
          promptTokens: 9900,
          completionTokens: 0,
          updatedAtMs: baseMs - 20_000,
        }),
        sessionTrace({
          sessionId,
          traceId,
          occurredAtMs: baseMs - 20_000,
          cost: 4,
          promptTokens: 400,
          completionTokens: 0,
          updatedAtMs: baseMs - 10_000,
        }),
      ]);

      const page = await repository.findSessionGroups(query());
      const session = page.rows.find((row) => row.conversationId === sessionId)!;

      expect(session.traceCount).toBe(1);
      expect(session.totalCost).toBeCloseTo(4);
      expect(session.totalTokens).toBe(400);
    });
  });

  describe("given a content term that only one session's transcript mentions", () => {
    /** @scenario Session content search matches transcript text in log records */
    it("returns only the session whose log body mentions the term", async () => {
      const page = await repository.findSessionGroups(query({ contentTerms: ["#6418"] }));

      expect(page.rows.map((row) => row.conversationId)).toEqual([SESSION_ALPHA]);
      // The rollup still sums the whole session, not the matching log alone.
      expect(page.rows[0]!.traceCount).toBe(3);
      expect(page.totalHits).toBe(1);
    });

    it("unions transcript matches with trace-level filter matches", async () => {
      const page = await repository.findSessionGroups(
        query({
          contentTerms: ["#6418"],
          filterWhere: {
            sql: "ComputedInput ILIKE {ft0:String}",
            params: { ft0: "%latest alpha prompt%" },
          },
        }),
      );

      expect(page.rows.map((row) => row.conversationId)).toEqual([SESSION_ALPHA]);
    });
  });

  describe("given a trace whose newer version no longer matches the filter", () => {
    it("decides filter membership on the latest version only", async () => {
      const sessionId = `${tag}-sess-superseded`;
      const traceId = `${tag}-superseded-1`;
      await insertTraceSummaries([
        sessionTrace({
          sessionId,
          traceId,
          occurredAtMs: baseMs - 30_000,
          cost: 1,
          promptTokens: 10,
          completionTokens: 5,
          updatedAtMs: baseMs - 30_000,
          computedInput: "superseded prompt text",
        }),
        sessionTrace({
          sessionId,
          traceId,
          occurredAtMs: baseMs - 30_000,
          cost: 1,
          promptTokens: 10,
          completionTokens: 5,
          updatedAtMs: baseMs - 25_000,
          computedInput: "current prompt text",
        }),
      ]);

      const stale = await repository.findSessionGroups(
        query({
          filterWhere: {
            sql: "ComputedInput ILIKE {supersededTerm:String}",
            params: { supersededTerm: "%superseded prompt text%" },
          },
        }),
      );
      expect(stale.rows.map((row) => row.conversationId)).not.toContain(sessionId);

      const current = await repository.findSessionGroups(
        query({
          filterWhere: {
            sql: "ComputedInput ILIKE {currentTerm:String}",
            params: { currentTerm: "%current prompt text%" },
          },
        }),
      );
      expect(current.rows.map((row) => row.conversationId)).toContain(sessionId);
    });
  });

  describe("given more sessions than one page", () => {
    /** @scenario Session keyset pagination walks every session exactly once */
    it("walks every session exactly once in descending last-activity order", async () => {
      const pagedTag = `${tag}-paged`;
      const seeded = Array.from({ length: 5 }, (_, index) =>
        sessionTrace({
          sessionId: `${pagedTag}-${index}`,
          traceId: `${pagedTag}-trace-${index}`,
          occurredAtMs: baseMs - 400_000 - index * 10_000,
          cost: 1,
          promptTokens: 10,
          completionTokens: 5,
        }),
      );
      await insertTraceSummaries(seeded);

      const seen: string[] = [];
      const activities: number[] = [];
      let cursor: SessionGroupsQuery["cursor"];
      let didReachLastPage = false;
      for (let guard = 0; guard < 10; guard++) {
        const page = await repository.findSessionGroups(query({ limit: 3, cursor }));
        const pageRows = page.rows.slice(0, 2);
        seen.push(...pageRows.map((row) => row.conversationId));
        activities.push(...pageRows.map((row) => row.lastActivityMs));
        if (page.rows.length <= 2) {
          didReachLastPage = true;
          break;
        }
        const last = pageRows[pageRows.length - 1]!;
        cursor = {
          sortValue: last.lastActivityMs,
          conversationId: last.conversationId,
        };
      }

      // Without this the walk running out of iterations lands on the
      // session-list assertion below, which reports a short walk as missing
      // rows rather than as the loop giving up.
      expect(didReachLastPage).toBe(true);
      const pagedSessions = seen.filter((id) => id.startsWith(pagedTag));
      expect(new Set(seen).size).toBe(seen.length);
      expect(pagedSessions).toEqual(
        Array.from({ length: 5 }, (_, index) => `${pagedTag}-${index}`),
      );
      const sortedActivities = [...activities].sort((a, b) => b - a);
      expect(activities).toEqual(sortedActivities);
    });
  });
});
