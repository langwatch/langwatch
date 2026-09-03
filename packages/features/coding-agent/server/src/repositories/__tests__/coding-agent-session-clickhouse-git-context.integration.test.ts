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

beforeAll(() => {
  if (clickHouseUrl === null) return;
  ch = createTestClickHouseClient(clickHouseUrl);
  sessions = CodingAgentSessionClickHouseRepository.create({
    clickHouse: new SingleClickHousePort(ch),
    defaultTraceRetentionDays: 30,
    metrics: NoopCodingAgentReadMetricsPort.create(),
    clock: new FixedClock(),
  });
});

afterAll(async () => {
  if (clickHouseUrl === null) return;
  await ch.close();
});

integration("coding_agent_sessions git context round-trip", () => {
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
});
