/**
 * @vitest-environment node
 * @integration
 *
 * Round-trips the three coding-agent tables (migrations 00051 / 00052) through
 * their real INSERT/SELECT SQL against ClickHouse. The unit tests cover the
 * query shape and record mapping with a mocked client; this proves the
 * DDL↔repository column contract — a mismatched column name or type fails a
 * real insert loudly, which no mock can catch — plus the ReplacingMergeTree
 * dedup / last-write-wins semantics ADR-056 relies on.
 */
import type { ClickHouseClient } from "@clickhouse/client";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { CodingAgentSessionRow } from "~/server/event-sourcing/pipelines/coding-agent-processing/projections/codingAgentSession.foldProjection";
import {
  startTestContainers,
  stopTestContainers,
} from "../../../../event-sourcing/__tests__/integration/testContainers";
import { CodingAgentSessionClickHouseRepository } from "../coding-agent-session.clickhouse.repository";
import { CodingAgentTraceSessionClickHouseRepository } from "../coding-agent-trace-session.repository";
import { SessionMetricSeriesClickHouseRepository } from "../session-metric-series.repository";

let ch: ClickHouseClient;
let sessions: CodingAgentSessionClickHouseRepository;
let traceSessions: CodingAgentTraceSessionClickHouseRepository;
let metricSeries: SessionMetricSeriesClickHouseRepository;

const tag = nanoid();
const tenantId = `${tag}-project`;
const baseMs = Date.now();

function sessionRow(
  over: Partial<CodingAgentSessionRow> = {},
): CodingAgentSessionRow {
  return {
    tenantId,
    sessionId: `${tag}-s`,
    sessionKeySource: "provider",
    version: "2026-07-21",
    startedAtMs: baseMs,
    state: "{}",
    agent: "claude_code",
    agentVersion: "2.0.0",
    traceIds: [`${tag}-t1`],
    finalRequestId: "req_last",
    userId: "user-1",
    terminalType: "xterm",
    entrypoint: "cli",
    modelCalls: 3,
    toolCalls: 5,
    subAgents: 1,
    prompts: 2,
    promptChars: 900,
    responseChars: 4000,
    steps: [
      ["Read", 2, false],
      ["Bash", 1, true],
    ],
    toolCounts: { Read: 2, Bash: 3 },
    toolDurationMs: { Bash: 1234 },
    filesTouched: ["a.ts"],
    skills: [],
    subAgentTypes: ["explorer"],
    slashCommands: [],
    models: ["claude-fable-5"],
    mcpServers: [],
    mcpTools: [],
    inputTokens: 100,
    outputTokens: 50,
    cacheReadTokens: 9_000_000_000,
    cacheCreationTokens: 10,
    costUsd: 1.25,
    modelCallMs: 5000,
    toolMs: 1234,
    ttftMsTotal: 300,
    ttftSamples: 3,
    blockedOnUserMs: 0,
    activeTimeUserSec: 120,
    activeTimeCliSec: 300,
    toolResultBytes: 4096,
    toolInputBytes: 128,
    compactions: 0,
    compactionTokensBefore: 0,
    compactionTokensAfter: 0,
    peakContextTokens: 9000,
    cacheRebuildCount: 0,
    largestCacheRebuildTokens: 0,
    failedTools: 1,
    errorTypes: { ShellError: 1 },
    apiErrors: 0,
    rateLimited: 0,
    retriesExhausted: 0,
    retryMs: 0,
    attempts: 3,
    refusals: 0,
    refusalCategories: [],
    internalErrors: 0,
    toolsDenied: 1,
    toolsAborted: 0,
    permissionMode: "default",
    permissionChanges: 0,
    hooksBlocked: 0,
    hooksCancelled: 0,
    hookMs: 0,
    linesAdded: 120,
    linesRemoved: 30,
    commits: 2,
    pullRequests: 1,
    editsAccepted: 4,
    editsRejected: 1,
    languagesEdited: ["typescript"],
    atMentions: 0,
    stopReason: "end_turn",
    truncated: false,
    ...over,
  };
}

beforeAll(async () => {
  const containers = await startTestContainers();
  ch = containers.clickHouseClient;
  sessions = new CodingAgentSessionClickHouseRepository(async () => ch);
  traceSessions = new CodingAgentTraceSessionClickHouseRepository(
    async () => ch,
  );
  metricSeries = new SessionMetricSeriesClickHouseRepository(async () => ch);
}, 60_000);

afterAll(async () => {
  if (ch) {
    for (const table of [
      "coding_agent_sessions",
      "coding_agent_trace_sessions",
      "session_metric_series",
    ]) {
      await ch.exec({
        query: `ALTER TABLE ${table} DELETE WHERE TenantId = {tenantId:String}`,
        query_params: { tenantId },
      });
    }
  }
  await stopTestContainers();
});

describe("coding_agent_sessions round-trip (migration 00051)", () => {
  it("writes every column and reads the session back by its key", async () => {
    const row = sessionRow({
      sessionId: `${tag}-rt`,
      traceIds: [`${tag}-a`, `${tag}-b`],
    });
    await sessions.upsert(row, 30);

    const read = await sessions.findBySessionId({
      tenantId,
      sessionId: `${tag}-rt`,
      startedAtMs: baseMs,
    });

    expect(read).not.toBeNull();
    // Bounded array + UInt64-as-string + Map columns all survive the trip.
    expect(read!.traceIds).toEqual([`${tag}-a`, `${tag}-b`]);
    expect(read!.cacheReadTokens).toBe(9_000_000_000);
    expect(read!.toolCounts).toEqual({ Read: 2, Bash: 3 });
    expect(read!.steps).toEqual([
      ["Read", 2, false],
      ["Bash", 1, true],
    ]);
    expect(read!.sessionKeySource).toBe("provider");
    expect(read!.costUsd).toBeCloseTo(1.25);
    expect(read!.commits).toBe(2);
  });

  it("round-trips the lossless State resume blob (migration 00053)", async () => {
    // The blob carries the fields the analytics columns drop — the read-back
    // path (ADR-066) depends on it surviving verbatim.
    const state = JSON.stringify({
      sessionId: `${tag}-blob`,
      subAgentIds: ["sub-1", "sub-2"],
      previousCallContextTokens: 7_000,
      metricSeries: {
        "removed-1": { metricName: "claude_code.lines_of_code.count", value: 10 },
      },
    });
    const row = sessionRow({ sessionId: `${tag}-blob`, state });
    await sessions.upsert(row, 30);

    const read = await sessions.findBySessionId({
      tenantId,
      sessionId: `${tag}-blob`,
      startedAtMs: baseMs,
    });

    expect(read).not.toBeNull();
    expect(read!.state).toBe(state);
    // And it parses back into the bookkeeping the read-back store relies on.
    const parsed = JSON.parse(read!.state) as {
      subAgentIds: string[];
      previousCallContextTokens: number;
      metricSeries: Record<string, unknown>;
    };
    expect(parsed.subAgentIds).toEqual(["sub-1", "sub-2"]);
    expect(parsed.previousCallContextTokens).toBe(7_000);
    expect(Object.keys(parsed.metricSeries)).toEqual(["removed-1"]);
  });

  it("dedups a re-folded session to one row (ReplacingMergeTree, no FINAL)", async () => {
    const row = sessionRow({ sessionId: `${tag}-dedup`, costUsd: 1 });
    await sessions.upsert(row, 30);
    await sessions.upsert({ ...row, costUsd: 2 }, 30);

    const listed = await sessions.findManyRecent({
      tenantId,
      fromMs: baseMs - 60_000,
      toMs: baseMs + 60_000,
      limit: 50,
    });

    const forSession = listed.filter((r) => r.sessionId === `${tag}-dedup`);
    expect(forSession).toHaveLength(1);
    // The later write wins.
    expect(forSession[0]!.costUsd).toBeCloseTo(2);
  });
});

describe("coding_agent_trace_sessions map (migration 00051)", () => {
  it("resolves a trace to its session", async () => {
    await traceSessions.ensure(
      [
        {
          tenantId,
          traceId: `${tag}-trace-x`,
          sessionId: `${tag}-sess-x`,
          occurredAtMs: baseMs,
        },
      ],
      30,
    );

    const mapping = await traceSessions.findByTraceId({
      tenantId,
      traceId: `${tag}-trace-x`,
    });
    expect(mapping?.sessionId).toBe(`${tag}-sess-x`);
  });
});

describe("session_metric_series converged totals (migration 00052)", () => {
  it("sums delta units and last-write-wins a re-observed cumulative unit", async () => {
    const sessionId = `${tag}-metrics`;
    // Two delta units of the same metric → each sums once.
    await metricSeries.ensure(
      [
        {
          tenantId,
          sessionId,
          seriesId: "delta-1",
          metricName: "claude_code.lines_of_code.count",
          metricUnit: "",
          agent: "claude_code",
          attributes: { type: "added" },
          value: 10,
          dataPointCount: 1,
          asOfUnixMs: baseMs,
        },
        {
          tenantId,
          sessionId,
          seriesId: "delta-2",
          metricName: "claude_code.lines_of_code.count",
          metricUnit: "",
          agent: "claude_code",
          attributes: { type: "added" },
          value: 5,
          dataPointCount: 1,
          asOfUnixMs: baseMs + 1000,
        },
      ],
      30,
    );
    // A cumulative unit re-observed with a NEWER AsOf must replace, not add.
    await metricSeries.ensure(
      [
        {
          tenantId,
          sessionId,
          seriesId: "cumulative-cost",
          metricName: "claude_code.cost.usage",
          metricUnit: "USD",
          agent: "claude_code",
          attributes: {},
          value: 0.5,
          dataPointCount: 2,
          asOfUnixMs: baseMs,
        },
      ],
      30,
    );
    await metricSeries.ensure(
      [
        {
          tenantId,
          sessionId,
          seriesId: "cumulative-cost",
          metricName: "claude_code.cost.usage",
          metricUnit: "USD",
          agent: "claude_code",
          attributes: {},
          value: 0.9,
          dataPointCount: 3,
          asOfUnixMs: baseMs + 5000,
        },
      ],
      30,
    );

    const totals = await metricSeries.findTotalsBySessionIds({
      tenantId,
      sessionIds: [sessionId],
      fromMs: baseMs - 60_000,
      toMs: baseMs + 60_000,
    });

    const linesAdded = totals.find(
      (t) =>
        t.metricName === "claude_code.lines_of_code.count" &&
        t.bucket === "added",
    );
    const cost = totals.find((t) => t.metricName === "claude_code.cost.usage");
    // 10 + 5 across two delta units.
    expect(linesAdded?.total).toBe(15);
    // The newer converged cost wins (0.9), the stale 0.5 is deduped away.
    expect(cost?.total).toBeCloseTo(0.9);

    // A byte-identical re-delivery (same unit, same AsOf) must also dedup —
    // the exact shape a subscriber retry produces.
    await metricSeries.ensure(
      [
        {
          tenantId,
          sessionId,
          seriesId: "cumulative-cost",
          metricName: "claude_code.cost.usage",
          metricUnit: "USD",
          agent: "claude_code",
          attributes: {},
          value: 0.9,
          dataPointCount: 3,
          asOfUnixMs: baseMs + 5000,
        },
      ],
      30,
    );
    const redelivered = await metricSeries.findTotalsBySessionIds({
      tenantId,
      sessionIds: [sessionId],
      fromMs: baseMs - 60_000,
      toMs: baseMs + 60_000,
    });
    const costAfterRedelivery = redelivered.find(
      (t) => t.metricName === "claude_code.cost.usage",
    );
    expect(costAfterRedelivery?.total).toBeCloseTo(0.9);

    // A correction at the SAME AsOf but a different value must converge on
    // the newest write (UpdatedAt breaks the AsOf tie), not an arbitrary row.
    await metricSeries.ensure(
      [
        {
          tenantId,
          sessionId,
          seriesId: "cumulative-cost",
          metricName: "claude_code.cost.usage",
          metricUnit: "USD",
          agent: "claude_code",
          attributes: {},
          value: 1.1,
          dataPointCount: 4,
          asOfUnixMs: baseMs + 5000,
        },
      ],
      30,
    );
    const corrected = await metricSeries.findTotalsBySessionIds({
      tenantId,
      sessionIds: [sessionId],
      fromMs: baseMs - 60_000,
      toMs: baseMs + 60_000,
    });
    const costAfterCorrection = corrected.find(
      (t) => t.metricName === "claude_code.cost.usage",
    );
    expect(costAfterCorrection?.total).toBeCloseTo(1.1);
  });
});
