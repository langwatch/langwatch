/**
 * Round-trips the session row's git-context and branch-set columns
 * (migrations 00075, 00077) through their real INSERT/SELECT SQL against
 * ClickHouse: the DDL <-> repository column contract the mocked unit tests
 * cannot catch, plus the read that finds a session under a branch it has
 * since left.
 *
 * @see specs/coding-agent/session-git-context.feature
 * @see specs/coding-agent/pull-request-linkage.feature
 */
import { randomUUID } from "node:crypto";
import type { ClickHouseClient } from "@clickhouse/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { NoopCodingAgentReadMetricsPort } from "../../adapters/coding-agent-read-metrics.adapter";
import { CodingAgentClickHousePort } from "../../ports/coding-agent-clickhouse.port";
import { CodingAgentClockPort } from "../../ports/coding-agent-clock.port";
import { CodingAgentSessionClickHouseRepository } from "../coding-agent-session/clickhouse.repository";
import { CodingAgentTraceSessionClickHouseRepository } from "../coding-agent-trace-session/clickhouse.repository";
import { SessionMetricSeriesClickHouseRepository } from "../session-metric-series/clickhouse.repository";
import { session } from "./fixtures/coding-agent.fixture";
import {
  createTestClickHouseClient,
  testClickHouseUrl,
} from "../coding-agent-session-event/__tests__/support/clickhouse-endpoint.support";

const clickHouseUrl = testClickHouseUrl();
const integration = describe.skipIf(clickHouseUrl === null);

class SingleClickHousePort extends CodingAgentClickHousePort {
  constructor(private readonly client: ClickHouseClient) {
    super();
  }

  async resolve() {
    return this.client;
  }
}

class FixedClock extends CodingAgentClockPort {
  nowMs(): number {
    return baseMs;
  }
}

const tag = randomUUID();
const tenantId = `${tag}-project`;
const baseMs = Date.now();

let ch: ClickHouseClient;
let sessions: CodingAgentSessionClickHouseRepository;
let traceSessions: CodingAgentTraceSessionClickHouseRepository;
let metricSeries: SessionMetricSeriesClickHouseRepository;

beforeAll(() => {
  if (clickHouseUrl === null) return;
  ch = createTestClickHouseClient(clickHouseUrl);
  sessions = CodingAgentSessionClickHouseRepository.create({
    clickHouse: new SingleClickHousePort(ch),
    defaultTraceRetentionDays: 30,
    metrics: NoopCodingAgentReadMetricsPort.create(),
    clock: new FixedClock(),
  });
  traceSessions = new CodingAgentTraceSessionClickHouseRepository(new SingleClickHousePort(ch), 30);
  metricSeries = new SessionMetricSeriesClickHouseRepository(new SingleClickHousePort(ch), 30);
});

afterAll(async () => {
  if (clickHouseUrl === null) return;
  await ch.exec({
    query: "ALTER TABLE coding_agent_trace_sessions DELETE WHERE TenantId = {tenantId:String}",
    query_params: { tenantId },
  });
  await ch.exec({
    query: "ALTER TABLE session_metric_series DELETE WHERE TenantId = {tenantId:String}",
    query_params: { tenantId },
  });
  await ch.close();
});

integration("coding_agent_sessions git context round-trip", () => {
  it("writes every column and reads the session back by its key", async () => {
    const row = session({
      tenantId,
      sessionId: `${tag}-rt`,
      startedAtMs: baseMs,
      traceIds: [`${tag}-a`, `${tag}-b`],
      cacheReadTokens: 9_000_000_000,
      toolCounts: { Read: 2, Bash: 3 },
      costUsd: 1.25,
      commits: 2,
    });
    await sessions.upsert(row, 30, []);

    const read = await sessions.tryFindBySessionId({
      tenantId,
      sessionId: `${tag}-rt`,
      window: { fromMs: baseMs - 60_000, toMs: baseMs + 60_000 },
    });

    expect(read).not.toBeNull();
    // Bounded array + UInt64-as-string + Map columns all survive the trip.
    expect(read!.traceIds).toEqual([`${tag}-a`, `${tag}-b`]);
    expect(read!.cacheReadTokens).toBe(9_000_000_000);
    expect(read!.toolCounts).toEqual({ Read: 2, Bash: 3 });
    expect(read!.costUsd).toBeCloseTo(1.25);
    expect(read!.commits).toBe(2);
  });

  it("dedups a re-folded session to one row (ReplacingMergeTree, no FINAL)", async () => {
    const row = session({ tenantId, sessionId: `${tag}-dedup`, startedAtMs: baseMs, costUsd: 1 });
    await sessions.upsert(row, 30, []);
    await sessions.upsert({ ...row, costUsd: 2 }, 30, []);

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
      session({ tenantId, sessionId: drifted, startedAtMs: baseMs, costUsd: 1 }),
      30,
      [],
    );
    await sessions.upsert(
      session({
        tenantId,
        sessionId: drifted,
        // Far outside the read window, but WELL inside the 30-day retention:
        // a drift equal to retentionDays parks this row exactly on the
        // table's TTL boundary, where a background merge can delete it.
        startedAtMs: baseMs - 15 * 24 * 60 * 60 * 1000,
        costUsd: 2,
      }),
      30,
      [],
    );

    const windowed = await sessions.tryFindBySessionId({
      tenantId,
      sessionId: drifted,
      window: { fromMs: baseMs - 60_000, toMs: baseMs + 60_000 },
    });
    const unwindowed = await sessions.tryFindBySessionId({ tenantId, sessionId: drifted });

    expect(windowed).toBeNull();
    expect(unwindowed?.costUsd).toBeCloseTo(2);
  });

  it("drops a session from a listed period once its latest StartedAt drifted out of it (ADR-071)", async () => {
    const drifted = `${tag}-list-drift`;
    const driftedStartMs = baseMs - 14 * 24 * 60 * 60 * 1000;
    await sessions.upsert(
      session({ tenantId, sessionId: drifted, startedAtMs: baseMs, costUsd: 1 }),
      30,
      [],
    );
    await sessions.upsert(
      session({ tenantId, sessionId: drifted, startedAtMs: driftedStartMs, costUsd: 2 }),
      30,
      [],
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
    const inNewPeriod = listedThen.filter((row) => row.sessionId === drifted);
    expect(inNewPeriod).toHaveLength(1);
    expect(inNewPeriod[0]!.costUsd).toBeCloseTo(2);
  });

  it("reads back the applied-event-id watermark next to the row (ADR-066)", async () => {
    const row = session({ tenantId, sessionId: `${tag}-applied`, startedAtMs: baseMs });
    await sessions.upsert(row, 30, ["ev-1", "ev-2"]);

    const withApplied = await sessions.tryFindBySessionIdWithApplied({
      tenantId,
      sessionId: `${tag}-applied`,
      window: { fromMs: baseMs - 60_000, toMs: baseMs + 60_000 },
    });
    const direct = await sessions.tryFindBySessionId({
      tenantId,
      sessionId: `${tag}-applied`,
      window: { fromMs: baseMs - 60_000, toMs: baseMs + 60_000 },
    });

    expect(withApplied).not.toBeNull();
    // The watermark rides beside the row, not inside it.
    expect(withApplied!.appliedEventIds).toEqual(["ev-1", "ev-2"]);
    expect(withApplied!.row).toEqual(direct);
  });

  it("reads back an empty watermark when a row is written without one", async () => {
    const row = session({ tenantId, sessionId: `${tag}-noapplied`, startedAtMs: baseMs });
    await sessions.upsert(row, 30, []);

    const withApplied = await sessions.tryFindBySessionIdWithApplied({
      tenantId,
      sessionId: `${tag}-noapplied`,
      window: { fromMs: baseMs - 60_000, toMs: baseMs + 60_000 },
    });

    expect(withApplied).not.toBeNull();
    expect(withApplied!.appliedEventIds).toEqual([]);
  });

  it("reads back an empty watermark for a pre-migration row that omits the column", async () => {
    const sessionId = `${tag}-legacy`;
    // The genuine mixed-deploy read: an old writer emits a JSONEachRow body
    // with no AppliedEventIds field at all, so ClickHouse supplies the
    // column default — an empty Array(String).
    await ch.insert({
      table: "coding_agent_sessions",
      values: [
        {
          TenantId: tenantId,
          SessionId: sessionId,
          StartedAt: new Date(baseMs),
          Version: "2026-07-21",
        },
      ],
      format: "JSONEachRow",
    });

    const withApplied = await sessions.tryFindBySessionIdWithApplied({
      tenantId,
      sessionId,
      window: { fromMs: baseMs - 60_000, toMs: baseMs + 60_000 },
    });

    expect(withApplied).not.toBeNull();
    expect(withApplied!.appliedEventIds).toEqual([]);
  });

  it("decodes a row written before the branch set column with no branches", async () => {
    const sessionId = `${tag}-pre-branches`;
    await ch.insert({
      table: "coding_agent_sessions",
      values: [
        {
          TenantId: tenantId,
          SessionId: sessionId,
          StartedAt: new Date(baseMs),
          Version: "2026-07-21",
          GitBranch: "feat/one",
        },
      ],
      format: "JSONEachRow",
    });

    const read = await sessions.tryFindBySessionId({
      tenantId,
      sessionId,
      window: { fromMs: baseMs - 60_000, toMs: baseMs + 60_000 },
    });

    expect(read).not.toBeNull();
    expect(read!.gitBranches).toEqual([]);
    expect(read!.gitBranch).toBe("feat/one");
  });

  /** @scenario "A session folds repo, branch, worktree and title into its row and reads back" */
  it("writes the git context and title and reads them back verbatim", async () => {
    const row = session({
      tenantId,
      sessionId: `${tag}-git`,
      startedAtMs: baseMs,
      repositoryHost: "github.com",
      repositoryOwner: "acme",
      repositoryName: "widgets",
      gitBranch: "feat/session-git-context",
      gitWorktree: "widgets-feat",
      title: "Add git context to the session row",
    });
    await sessions.upsert(row, 30, []);

    const read = await sessions.tryFindBySessionId({
      tenantId,
      sessionId: `${tag}-git`,
      window: { fromMs: baseMs - 60_000, toMs: baseMs + 60_000 },
    });

    expect(read).not.toBeNull();
    expect(read!.repositoryHost).toBe("github.com");
    expect(read!.repositoryOwner).toBe("acme");
    expect(read!.repositoryName).toBe("widgets");
    expect(read!.gitBranch).toBe("feat/session-git-context");
    expect(read!.gitWorktree).toBe("widgets-feat");
    expect(read!.title).toBe("Add git context to the session row");
  });

  /** @scenario "A session row from before the git context columns decodes with empty context" */
  it("decodes a row written before the git context columns with empty context", async () => {
    const sessionId = `${tag}-pre-git`;
    // The genuine mixed-deploy read: a writer from before migration 00075
    // emits a JSONEachRow body with none of the six fields, so ClickHouse
    // supplies each column's DEFAULT ''. Inserted through the same client
    // the repository resolves.
    await ch.insert({
      table: "coding_agent_sessions",
      values: [
        {
          TenantId: tenantId,
          SessionId: sessionId,
          StartedAt: new Date(baseMs),
          Version: "2026-07-21",
          Agent: "claude_code",
          ModelCalls: 7,
          CostUsd: 1.5,
        },
      ],
      format: "JSONEachRow",
    });

    const read = await sessions.tryFindBySessionId({
      tenantId,
      sessionId,
      window: { fromMs: baseMs - 60_000, toMs: baseMs + 60_000 },
    });

    expect(read).not.toBeNull();
    expect(read!.repositoryHost).toBe("");
    expect(read!.repositoryOwner).toBe("");
    expect(read!.repositoryName).toBe("");
    expect(read!.gitBranch).toBe("");
    expect(read!.gitWorktree).toBe("");
    expect(read!.title).toBe("");
    // The rest of the session is intact: the missing columns cost nothing
    // else on the read.
    expect(read!.agent).toBe("claude_code");
    expect(read!.modelCalls).toBe(7);
    expect(read!.costUsd).toBeCloseTo(1.5);
  });

  /** @scenario "The branch set round-trips through the session row" */
  it("writes every branch the session drove and reads them back in order", async () => {
    const row = session({
      tenantId,
      sessionId: `${tag}-branches`,
      startedAtMs: baseMs,
      gitBranch: "feat/session-git-context",
      gitBranches: ["main", "feat/session-git-context"],
    });
    await sessions.upsert(row, 30, []);

    const read = await sessions.tryFindBySessionId({
      tenantId,
      sessionId: `${tag}-branches`,
      window: { fromMs: baseMs - 60_000, toMs: baseMs + 60_000 },
    });

    expect(read).not.toBeNull();
    expect(read!.gitBranches).toEqual(["main", "feat/session-git-context"]);
    // The scalar keeps saying which branch the session ended on.
    expect(read!.gitBranch).toBe("feat/session-git-context");
  });
});

integration("coding_agent_sessions by repository branch", () => {
  beforeAll(async () => {
    await sessions.upsert(
      session({
        tenantId,
        sessionId: `${tag}-moved`,
        startedAtMs: baseMs,
        repositoryHost: "github.com",
        repositoryOwner: "acme",
        repositoryName: "widgets",
        gitBranch: "feat/second",
        gitBranches: ["feat/first", "feat/second"],
        title: "Ship both branches",
      }),
      30,
      [],
    );
  });

  /** @scenario "A session that moved to another branch is still read for the branch it left" */
  it("lists a session under every branch it drove, not only its last", async () => {
    const listed = await sessions.listByRepositoryBranch({
      tenantIds: [tenantId],
      repositoryHost: "github.com",
      repositoryOwner: "acme",
      repositoryName: "widgets",
      // The branch the session left behind, which is where its first pull
      // request was opened.
      branches: ["feat/first"],
      startedAtFromMs: baseMs - 60_000,
    });

    const found = listed.find((row) => row.sessionId === `${tag}-moved`);
    expect(found).toBeDefined();
    // The row still reports the branch it ended on, and now carries the
    // title the detail names it by.
    expect(found!.gitBranch).toBe("feat/second");
    expect(found!.title).toBe("Ship both branches");
    // The whole set comes back too, which is what attribution runs the
    // tenure rule over: matched on a branch it left, the row would
    // otherwise reach the rollup knowing only a branch that pull request
    // never had.
    expect(found!.gitBranches).toEqual(["feat/first", "feat/second"]);
  });

  it("still matches the branch the session ended on", async () => {
    const listed = await sessions.listByRepositoryBranch({
      tenantIds: [tenantId],
      repositoryHost: "github.com",
      repositoryOwner: "acme",
      repositoryName: "widgets",
      branches: ["feat/second"],
      startedAtFromMs: baseMs - 60_000,
    });

    expect(listed.map((row) => row.sessionId).includes(`${tag}-moved`)).toBe(true);
  });

  it("leaves out a session that drove neither branch", async () => {
    await sessions.upsert(
      session({
        tenantId,
        sessionId: `${tag}-elsewhere`,
        startedAtMs: baseMs,
        repositoryHost: "github.com",
        repositoryOwner: "acme",
        repositoryName: "widgets",
        gitBranch: "chore/unrelated",
        gitBranches: ["chore/unrelated"],
      }),
      30,
      [],
    );

    const listed = await sessions.listByRepositoryBranch({
      tenantIds: [tenantId],
      repositoryHost: "github.com",
      repositoryOwner: "acme",
      repositoryName: "widgets",
      branches: ["feat/first"],
      startedAtFromMs: baseMs - 60_000,
    });

    expect(listed.map((row) => row.sessionId).includes(`${tag}-elsewhere`)).toBe(false);
  });

  it("fetches the same row shape by session id, whatever repository the row names", async () => {
    const listed = await sessions.listBySessionIds({
      tenantIds: [tenantId],
      sessionIds: [`${tag}-moved`],
      startedAtFromMs: baseMs - 60_000,
    });

    expect(listed).toHaveLength(1);
    expect(listed[0]!.sessionId).toBe(`${tag}-moved`);
    expect(listed[0]!.gitBranches).toEqual(["feat/first", "feat/second"]);
    expect(listed[0]!.title).toBe("Ship both branches");
  });

  it("answers nothing for a session id never folded", async () => {
    const listed = await sessions.listBySessionIds({
      tenantIds: [tenantId],
      sessionIds: [`${tag}-never-existed`],
      startedAtFromMs: baseMs - 60_000,
    });

    expect(listed).toEqual([]);
  });
});

integration("coding_agent_trace_sessions map", () => {
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

    const mapping = await traceSessions.tryFindByTraceId({
      tenantId,
      traceId: `${tag}-trace-x`,
    });
    expect(mapping?.sessionId).toBe(`${tag}-sess-x`);
  });
});

integration("session_metric_series converged totals", () => {
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
      (t) => t.metricName === "claude_code.lines_of_code.count" && t.bucket === "added",
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
    const costAfterRedelivery = redelivered.find((t) => t.metricName === "claude_code.cost.usage");
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
    const costAfterCorrection = corrected.find((t) => t.metricName === "claude_code.cost.usage");
    expect(costAfterCorrection?.total).toBeCloseTo(1.1);
  });
});
