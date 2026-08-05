/**
 * Sessions lens service: cursor codec, DTO mapping, and the coding-agent
 * enrichment overlay.
 *
 * @see specs/traces-v2/sessions-lens.feature
 */
import { describe, expect, it } from "vitest";
import type {
  SessionGroupRow,
  SessionGroupsQuery,
  SessionGroupsRepository,
} from "../repositories/session-groups.repository";
import type {
  CodingAgentSessionLookup,
  SessionGroupCodingAgentDto,
} from "../session-groups.service";
import {
  decodeSessionGroupsCursor,
  encodeSessionGroupsCursor,
  SessionGroupsService,
} from "../session-groups.service";
import { teaserOf } from "../visibility-window.service";

const TENANT = "project-1";

function makeRow(overrides: Partial<SessionGroupRow> = {}): SessionGroupRow {
  return {
    conversationId: "session-a",
    traceCount: 3,
    totalCost: 1.25,
    totalTokens: 4200,
    cacheReadTokens: 90_000,
    cacheCreationTokens: 1200,
    contextSizeTokens: 52_000,
    totalDurationMs: 63_000,
    startedAtMs: 1_700_000_000_000,
    lastActivityMs: 1_700_000_600_000,
    models: ["claude-sonnet-4", "claude-haiku-4"],
    primaryModel: "claude-sonnet-4",
    serviceName: "cli",
    errorCount: 1,
    warningCount: 0,
    totalSpans: 12,
    input: "fix the flaky test",
    output: "done, pushed",
    ...overrides,
  };
}

/**
 * The enrichment as the SESSION ROW carries it: a column nothing reported is
 * an empty string, and mapping those to null is the service's job.
 */
function codingAgentRow(
  over: Partial<SessionGroupCodingAgentDto> = {},
): SessionGroupCodingAgentDto {
  return {
    modelCalls: 0,
    compactions: 0,
    peakContextTokens: 0,
    subAgents: 0,
    repositoryHost: "",
    repositoryOwner: "",
    repositoryName: "",
    gitBranch: "",
    gitWorktree: "",
    title: "",
    ...over,
  };
}

/** Git context as the DTO spells "nothing reported this". */
const NO_GIT_CONTEXT = {
  repositoryHost: null,
  repositoryOwner: null,
  repositoryName: null,
  gitBranch: null,
  gitWorktree: null,
  title: null,
};

class FakeRepository implements SessionGroupsRepository {
  lastQuery: SessionGroupsQuery | null = null;
  constructor(
    private readonly rows: SessionGroupRow[],
    private readonly totalHits = 0,
  ) {}
  async findSessionGroups(query: SessionGroupsQuery) {
    this.lastQuery = query;
    return {
      rows: this.rows.slice(0, query.limit),
      totalHits: this.totalHits,
    };
  }
}

function lookupReturning(
  bySessionId: Record<string, SessionGroupCodingAgentDto | null>,
  calls: string[] = [],
): CodingAgentSessionLookup {
  return {
    async getBySessionId({ sessionId }) {
      calls.push(sessionId);
      return bySessionId[sessionId] ?? null;
    },
  };
}

const CURSOR_SORT = {
  sortColumn: "lastActivity",
  sortDirection: "desc",
} as const;

describe("session groups cursor codec", () => {
  describe("given a cursor with a sort value, conversation id and sort", () => {
    /** @scenario Session cursor encode and decode round-trip */
    it("round-trips through encode and decode", () => {
      const cursor = {
        sortValue: 1_700_000_600_000,
        conversationId: "s-1",
        ...CURSOR_SORT,
      };
      expect(
        decodeSessionGroupsCursor(encodeSessionGroupsCursor(cursor)),
      ).toEqual(cursor);
    });

    it("rejects malformed cursors", () => {
      expect(() => decodeSessionGroupsCursor("not base64 json")).toThrow(
        "Invalid sessions cursor",
      );
      expect(() =>
        decodeSessionGroupsCursor(
          Buffer.from(JSON.stringify({ sortValue: "high" }), "utf8").toString(
            "base64url",
          ),
        ),
      ).toThrow("Invalid sessions cursor");
    });

    it("rejects a cursor missing the sort it was minted under", () => {
      expect(() =>
        decodeSessionGroupsCursor(
          Buffer.from(
            JSON.stringify({ sortValue: 1, conversationId: "s-1" }),
            "utf8",
          ).toString("base64url"),
        ),
      ).toThrow("Invalid sessions cursor");
    });
  });
});

describe("SessionGroupsService", () => {
  describe("given a page of rollup rows", () => {
    /** @scenario Coding agent enrichment attaches model calls and compactions */
    it("attaches coding-agent counters when a session row exists and leaves others null", async () => {
      const calls: string[] = [];
      const service = new SessionGroupsService(
        new FakeRepository(
          [makeRow(), makeRow({ conversationId: "session-b" })],
          2,
        ),
        lookupReturning(
          {
            "session-a": codingAgentRow({
              modelCalls: 41,
              compactions: 2,
              peakContextTokens: 180_000,
              subAgents: 3,
            }),
          },
          calls,
        ),
      );

      const result = await service.getSessionGroups({
        tenantId: TENANT,
        timeRange: { from: 0, to: 2_000_000_000_000 },
        pageSize: 10,
      });

      expect(calls.sort()).toEqual(["session-a", "session-b"]);
      expect(result.sessions[0]?.codingAgent).toEqual({
        modelCalls: 41,
        compactions: 2,
        peakContextTokens: 180_000,
        subAgents: 3,
        ...NO_GIT_CONTEXT,
      });
      expect(result.sessions[1]?.codingAgent).toBeNull();
    });

    /** @scenario Coding agent enrichment carries repository, branch, worktree and title */
    it("carries the repository, branch, worktree and title, empty where unreported", async () => {
      const service = new SessionGroupsService(
        new FakeRepository(
          [makeRow(), makeRow({ conversationId: "session-b" })],
          2,
        ),
        lookupReturning({
          "session-a": codingAgentRow({
            repositoryHost: "github.com",
            repositoryOwner: "acme",
            repositoryName: "widgets",
            gitBranch: "feat/git-context",
            gitWorktree: "widgets-feat",
            title: "Add git context to the session row",
          }),
          // A session whose agent has no companion emitter: the row stores
          // empty strings, and the lens reads them as nothing reported.
          "session-b": codingAgentRow(),
        }),
      );

      const result = await service.getSessionGroups({
        tenantId: TENANT,
        timeRange: { from: 0, to: 2_000_000_000_000 },
        pageSize: 10,
      });

      expect(result.sessions[0]?.codingAgent).toMatchObject({
        repositoryHost: "github.com",
        repositoryOwner: "acme",
        repositoryName: "widgets",
        gitBranch: "feat/git-context",
        gitWorktree: "widgets-feat",
        title: "Add git context to the session row",
      });
      expect(result.sessions[1]?.codingAgent).toMatchObject({
        repositoryHost: null,
        repositoryOwner: null,
        repositoryName: null,
        gitBranch: null,
        gitWorktree: null,
        title: null,
      });
    });

    it("keeps the list alive when an enrichment lookup throws", async () => {
      const service = new SessionGroupsService(
        new FakeRepository([makeRow()]),
        {
          async getBySessionId() {
            throw new Error("clickhouse hiccup");
          },
        },
      );

      const result = await service.getSessionGroups({
        tenantId: TENANT,
        timeRange: { from: 0, to: 2_000_000_000_000 },
        pageSize: 10,
      });

      expect(result.sessions).toHaveLength(1);
      expect(result.sessions[0]?.codingAgent).toBeNull();
    });

    it("maps every rollup field onto the DTO", async () => {
      const service = new SessionGroupsService(
        new FakeRepository([makeRow()], 1),
        lookupReturning({}),
      );

      const result = await service.getSessionGroups({
        tenantId: TENANT,
        timeRange: { from: 0, to: 2_000_000_000_000 },
        pageSize: 10,
      });

      expect(result.sessions[0]).toMatchObject({
        conversationId: "session-a",
        traceCount: 3,
        totalCost: 1.25,
        totalTokens: 4200,
        cacheReadTokens: 90_000,
        cacheCreationTokens: 1200,
        contextSizeTokens: 52_000,
        totalDurationMs: 63_000,
        startedAtMs: 1_700_000_000_000,
        lastActivityMs: 1_700_000_600_000,
        primaryModel: "claude-sonnet-4",
        serviceName: "cli",
        errorCount: 1,
        totalSpans: 12,
        input: "fix the flaky test",
        output: "done, pushed",
      });
      expect(result.totalHits).toBe(1);
      expect(result.nextCursor).toBeNull();
    });
  });

  describe("when the repository returns one row past the page size", () => {
    it("emits a cursor carrying the last visible row's sort value", async () => {
      const rows = [
        makeRow({ conversationId: "s-1", lastActivityMs: 300 }),
        makeRow({ conversationId: "s-2", lastActivityMs: 200 }),
        makeRow({ conversationId: "s-3", lastActivityMs: 100 }),
      ];
      const service = new SessionGroupsService(
        new FakeRepository(rows, 3),
        lookupReturning({}),
      );

      const result = await service.getSessionGroups({
        tenantId: TENANT,
        timeRange: { from: 0, to: 2_000_000_000_000 },
        pageSize: 2,
      });

      expect(result.sessions.map((s) => s.conversationId)).toEqual([
        "s-1",
        "s-2",
      ]);
      expect(result.nextCursor).not.toBeNull();
      expect(decodeSessionGroupsCursor(result.nextCursor!)).toEqual({
        sortValue: 200,
        conversationId: "s-2",
        ...CURSOR_SORT,
      });
    });

    it("keys the cursor off the active sort dimension", async () => {
      const rows = [
        makeRow({ conversationId: "s-1", totalCost: 9 }),
        makeRow({ conversationId: "s-2", totalCost: 5 }),
        makeRow({ conversationId: "s-3", totalCost: 1 }),
      ];
      const repository = new FakeRepository(rows, 3);
      const service = new SessionGroupsService(repository, lookupReturning({}));

      const result = await service.getSessionGroups({
        tenantId: TENANT,
        timeRange: { from: 0, to: 2_000_000_000_000 },
        sort: { columnId: "cost", direction: "desc" },
        pageSize: 2,
      });

      expect(repository.lastQuery?.sort).toEqual({
        column: "cost",
        direction: "desc",
      });
      expect(decodeSessionGroupsCursor(result.nextCursor!)).toEqual({
        sortValue: 5,
        conversationId: "s-2",
        sortColumn: "cost",
        sortDirection: "desc",
      });
    });
  });

  describe("when the sort column is unknown", () => {
    it("falls back to last activity", async () => {
      const repository = new FakeRepository([makeRow()]);
      const service = new SessionGroupsService(repository, lookupReturning({}));

      await service.getSessionGroups({
        tenantId: TENANT,
        timeRange: { from: 0, to: 2_000_000_000_000 },
        sort: { columnId: "spans", direction: "asc" },
        pageSize: 10,
      });

      expect(repository.lastQuery?.sort).toEqual({
        column: "lastActivity",
        direction: "asc",
      });
    });
  });

  describe("when the cursor was minted under a different sort", () => {
    /** @scenario A session cursor from another sort is refused */
    it("refuses the read instead of paging through another order", async () => {
      const repository = new FakeRepository([makeRow()]);
      const service = new SessionGroupsService(repository, lookupReturning({}));
      const cursor = encodeSessionGroupsCursor({
        sortValue: 5,
        conversationId: "s-2",
        sortColumn: "cost",
        sortDirection: "desc",
      });

      await expect(
        service.getSessionGroups({
          tenantId: TENANT,
          timeRange: { from: 0, to: 2_000_000_000_000 },
          sort: { columnId: "lastTurn", direction: "desc" },
          pageSize: 10,
          cursor,
        }),
      ).rejects.toThrow("Sessions cursor does not match the sort");
      expect(repository.lastQuery).toBeNull();
    });
  });

  describe("when the cursor was minted under the same sort", () => {
    it("passes the keyset boundary through to the repository", async () => {
      const repository = new FakeRepository([makeRow()]);
      const service = new SessionGroupsService(repository, lookupReturning({}));
      const cursor = encodeSessionGroupsCursor({
        sortValue: 5,
        conversationId: "s-2",
        sortColumn: "cost",
        sortDirection: "desc",
      });

      await service.getSessionGroups({
        tenantId: TENANT,
        timeRange: { from: 0, to: 2_000_000_000_000 },
        sort: { columnId: "cost", direction: "desc" },
        pageSize: 10,
        cursor,
      });

      expect(repository.lastQuery?.cursor).toEqual({
        sortValue: 5,
        conversationId: "s-2",
      });
    });
  });

  describe("when a session's last activity is older than the visibility cutoff", () => {
    it("teases the previews and keeps the totals", async () => {
      const service = new SessionGroupsService(
        new FakeRepository([
          makeRow({
            lastActivityMs: 1000,
            input: "a very long captured prompt that must not leak in full",
          }),
        ]),
        lookupReturning({}),
      );

      const result = await service.getSessionGroups({
        tenantId: TENANT,
        timeRange: { from: 0, to: 2_000_000_000_000 },
        pageSize: 10,
        visibilityCutoffMs: 2000,
      });

      const session = result.sessions[0]!;
      expect(session.input).not.toBe(
        "a very long captured prompt that must not leak in full",
      );
      expect(session.totalTokens).toBe(4200);
      expect(session.traceCount).toBe(3);
    });

    /** @scenario A session beyond the visibility window teases its title */
    it("teases the generated title the same way, and leaves the git context whole", async () => {
      const title =
        "Rebuild the flaky session fold test and its ClickHouse fixture";
      const service = new SessionGroupsService(
        new FakeRepository([makeRow({ lastActivityMs: 1000 })]),
        lookupReturning({
          "session-a": codingAgentRow({
            title,
            repositoryOwner: "acme",
            repositoryName: "widgets",
            gitBranch: "feat/git-context",
          }),
        }),
      );

      const result = await service.getSessionGroups({
        tenantId: TENANT,
        timeRange: { from: 0, to: 2_000_000_000_000 },
        pageSize: 10,
        visibilityCutoffMs: 2000,
      });

      const codingAgent = result.sessions[0]!.codingAgent!;
      expect(codingAgent.title).toBe(teaserOf(title));
      expect(codingAgent.title).not.toBe(title);
      // Where the session ran is operational metadata, not conversation
      // content, so the window does not touch it.
      expect(codingAgent.repositoryOwner).toBe("acme");
      expect(codingAgent.repositoryName).toBe("widgets");
      expect(codingAgent.gitBranch).toBe("feat/git-context");
    });
  });
});
