/**
 * @vitest-environment node
 * @integration
 *
 * Round-trips the three coding-agent tables (migrations 00051-00054, 00068)
 * through their real INSERT/SELECT SQL against ClickHouse. The unit tests cover
 * the query shape and record mapping with a mocked client; this proves the
 * DDL↔repository column contract — a mismatched column name or type fails a
 * real insert loudly, which no mock can catch — plus the ReplacingMergeTree
 * dedup / last-write-wins semantics ADR-056 relies on. It also covers the
 * ADR-066 additions: the 00053 read-back state columns (sub-agent ids, ordered
 * step start times, previous-call context, converged metric units) that let
 * store.get() reconstruct working state without touching event_log, the
 * 00054 AppliedEventIds watermark that survives cache loss — including the
 * mixed-deploy read of a pre-00054 row whose body omits the column entirely —
 * and the 00068 context-economics columns (reported rate-limit events,
 * compactions by trigger, spawn lineage).
 */
import type { ClickHouseClient } from "@clickhouse/client";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { CodingAgentSessionRow } from "~/server/event-sourcing/pipelines/coding-agent-processing/projections/codingAgentSession.foldProjection";
import { CODING_AGENT_SESSION_PROJECTION_VERSION_LATEST } from "~/server/event-sourcing/pipelines/coding-agent-processing/projections/codingAgentSession.foldProjection";
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
    version: CODING_AGENT_SESSION_PROJECTION_VERSION_LATEST,
    startedAtMs: baseMs,
    agent: "claude_code",
    agentVersion: "2.0.0",
    traceIds: [`${tag}-t1`],
    finalRequestId: "req_last",
    userId: "user-1",
    terminalType: "xterm",
    entrypoint: "cli",
    parentSessionId: `${tag}-parent`,
    isFork: true,
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
    compactions: 3,
    compactionTokensBefore: 0,
    compactionTokensAfter: 0,
    compactionTriggers: { auto: 2, manual: 1 },
    peakContextTokens: 9000,
    cacheRebuildCount: 0,
    largestCacheRebuildTokens: 0,
    failedTools: 1,
    errorTypes: { ShellError: 1 },
    apiErrors: 0,
    rateLimited: 0,
    rateLimitEvents: 2,
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
    subAgentIds: [`${tag}-sub-a`, `${tag}-sub-b`],
    stepStartedAt: [baseMs + 10, baseMs + 20],
    previousCallContextTokens: 9_000_000_000,
    metricSeries: [
      {
        seriesId: `${tag}-loc-added`,
        metricName: "lines_of_code.count",
        type: "added",
        decision: "",
        language: "",
        value: 120,
      },
      {
        seriesId: `${tag}-edits`,
        metricName: "code_edit_tool.decision",
        type: "",
        decision: "accept",
        language: "typescript",
        value: 4,
      },
    ],
    createdAt: baseMs,
    updatedAt: baseMs,
    lastEventOccurredAt: baseMs + 20,
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

describe("coding_agent_sessions round-trip (migrations 00051-00054)", () => {
  it("writes every column and reads the session back by its key", async () => {
    const row = sessionRow({
      sessionId: `${tag}-rt`,
      traceIds: [`${tag}-a`, `${tag}-b`],
    });
    await sessions.upsert(row, 30);

    const read = await sessions.findBySessionId({
      tenantId,
      sessionId: `${tag}-rt`,
      window: { fromMs: baseMs - 60_000, toMs: baseMs + 60_000 },
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

    // Context-economics columns (migration 00068): the trigger map, the
    // reported rate-limit counter and the spawn lineage all survive the trip.
    expect(read!.compactionTriggers).toEqual({ auto: 2, manual: 1 });
    expect(read!.rateLimitEvents).toBe(2);
    expect(read!.parentSessionId).toBe(`${tag}-parent`);
    expect(read!.isFork).toBe(true);

    // Read-back columns (migration 00053, ADR-066) survive the trip so
    // store.get() can reconstruct working state without touching event_log.
    expect(read!.subAgentIds).toEqual([`${tag}-sub-a`, `${tag}-sub-b`]);
    expect(read!.stepStartedAt).toEqual([baseMs + 10, baseMs + 20]);
    expect(read!.previousCallContextTokens).toBe(9_000_000_000);
    expect(read!.metricSeries).toEqual([
      {
        seriesId: `${tag}-loc-added`,
        metricName: "lines_of_code.count",
        type: "added",
        decision: "",
        language: "",
        value: 120,
      },
      {
        seriesId: `${tag}-edits`,
        metricName: "code_edit_tool.decision",
        type: "",
        decision: "accept",
        language: "typescript",
        value: 4,
      },
    ]);
    // DateTime64 columns come back without a timezone, so exact-equality is
    // machine-dependent; assert the column is populated and roughly right.
    expect(read!.lastEventOccurredAt).toBeGreaterThan(0);
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

  it("returns empty, not a stale version, when the latest StartedAt drifted outside the window", async () => {
    // v1 starts inside the window; v2 (the true latest) backdates StartedAt
    // far outside it. A windowed read must NOT dedup to v1 — the inner
    // max(UpdatedAt) seek is unwindowed, so the drifted latest makes the
    // outer windowed read empty and the caller's unwindowed retry recovers
    // the real row instead of folding onto (and overwriting) stale state.
    const drifted = `${tag}-drift`;
    await sessions.upsert(
      sessionRow({ sessionId: drifted, startedAtMs: baseMs, costUsd: 1 }),
      30,
    );
    await sessions.upsert(
      sessionRow({
        sessionId: drifted,
        // Far outside the read window, but WELL inside the 30-day retention:
        // a drift equal to retentionDays parks this row exactly on the table's
        // `StartedAt + toIntervalDay(_retention_days)` TTL boundary, where any
        // background merge DELETEs it mid-test and the reads fall back to v1.
        startedAtMs: baseMs - 15 * 24 * 60 * 60 * 1000,
        costUsd: 2,
      }),
      30,
    );

    const windowed = await sessions.findBySessionId({
      tenantId,
      sessionId: drifted,
      window: { fromMs: baseMs - 60_000, toMs: baseMs + 60_000 },
    });
    const unwindowed = await sessions.findBySessionId({
      tenantId,
      sessionId: drifted,
    });

    expect(windowed).toBeNull();
    expect(unwindowed?.costUsd).toBeCloseTo(2);
  });

  it("drops a session from a listed period once its latest StartedAt drifted out of it (ADR-071)", async () => {
    // The list read's version of the case above. v1 sits inside the listed
    // period; v2 — the true latest — backdates StartedAt two weeks out. The
    // dedup subquery is unwindowed, so it resolves v2 and the outer period
    // filter then excludes the session: absent, rather than rendered at a
    // start time it no longer has with v1's stale cost. Windowing the dedup
    // scope instead brings v1 back with costUsd 1.
    const drifted = `${tag}-list-drift`;
    const driftedStartMs = baseMs - 14 * 24 * 60 * 60 * 1000;
    await sessions.upsert(
      sessionRow({ sessionId: drifted, startedAtMs: baseMs, costUsd: 1 }),
      30,
    );
    await sessions.upsert(
      sessionRow({
        sessionId: drifted,
        startedAtMs: driftedStartMs,
        costUsd: 2,
      }),
      30,
    );

    const listedNow = await sessions.findManyRecent({
      tenantId,
      fromMs: baseMs - 60_000,
      toMs: baseMs + 60_000,
      limit: 50,
    });
    const listedThen = await sessions.findManyRecent({
      tenantId,
      fromMs: driftedStartMs - 60_000,
      toMs: driftedStartMs + 60_000,
      limit: 50,
    });

    expect(listedNow.map((row) => row.sessionId)).not.toContain(drifted);
    // Absent from the period it left, present exactly once — with its latest
    // totals — in the period it moved into.
    const inNewPeriod = listedThen.filter((row) => row.sessionId === drifted);
    expect(inNewPeriod).toHaveLength(1);
    expect(inNewPeriod[0]!.costUsd).toBeCloseTo(2);
  });

  it("reads back the applied-event-id watermark next to the row (ADR-066)", async () => {
    const row = sessionRow({ sessionId: `${tag}-applied` });
    await sessions.upsert(row, 30, ["ev-1", "ev-2"]);

    const withApplied = await sessions.findBySessionIdWithApplied({
      tenantId,
      sessionId: `${tag}-applied`,
      window: { fromMs: baseMs - 60_000, toMs: baseMs + 60_000 },
    });
    const direct = await sessions.findBySessionId({
      tenantId,
      sessionId: `${tag}-applied`,
      window: { fromMs: baseMs - 60_000, toMs: baseMs + 60_000 },
    });

    expect(withApplied).not.toBeNull();
    // The watermark rides beside the row, not inside it.
    expect(withApplied!.appliedEventIds).toEqual(["ev-1", "ev-2"]);
    // The mapped row is exactly what findBySessionId returns — one read, same
    // query, same decode.
    expect(withApplied!.row).toEqual(direct);
  });

  it("reads back an empty watermark when a row is written without one", async () => {
    const row = sessionRow({ sessionId: `${tag}-noapplied` });
    await sessions.upsert(row, 30);

    const withApplied = await sessions.findBySessionIdWithApplied({
      tenantId,
      sessionId: `${tag}-noapplied`,
      window: { fromMs: baseMs - 60_000, toMs: baseMs + 60_000 },
    });

    expect(withApplied).not.toBeNull();
    expect(withApplied!.appliedEventIds).toEqual([]);
  });

  it("reads back an empty watermark for a pre-migration row that omits the column", async () => {
    const sessionId = `${tag}-legacy`;
    // The genuine mixed-deploy read: an old writer (or any row written before
    // migration 00054) emits a JSONEachRow body with NO AppliedEventIds field
    // at all, so ClickHouse supplies the column default — an empty
    // Array(String). This is distinct from the case above, where `toRecord`
    // still writes AppliedEventIds: []; here the field never leaves the writer,
    // exercising the column default and the mapper's asStringArray fallback
    // directly. Inserted through the same client the repository resolves.
    await ch.insert({
      table: "coding_agent_sessions",
      values: [
        {
          TenantId: tenantId,
          SessionId: sessionId,
          StartedAt: new Date(baseMs),
          Version: CODING_AGENT_SESSION_PROJECTION_VERSION_LATEST,
        },
      ],
      format: "JSONEachRow",
    });

    const withApplied = await sessions.findBySessionIdWithApplied({
      tenantId,
      sessionId,
      window: { fromMs: baseMs - 60_000, toMs: baseMs + 60_000 },
    });

    expect(withApplied).not.toBeNull();
    expect(withApplied!.appliedEventIds).toEqual([]);
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
