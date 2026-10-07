import { describe, expect, it } from "vitest";

import type {
  SessionGroupRow,
  SessionGroupsQuery,
  SessionGroupsRepository,
} from "../../../repositories/session-groups.repository.ts";
/**
 * @see specs/traces-v2/sessions-lens.feature
 * Sessions lens service: cursor codec and DTO mapping; coding-agent enriches the page it serves.
 */
import {
  SessionGroupsService as TraceSessionGroupsCursorService,
  SessionGroupsService,
} from "../../trace-session-groups.service.ts";

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
    lastTraceId: "trace-latest",
    input: "fix the flaky test",
    output: "done, pushed",
    ...overrides,
  };
}

class FakeRepository implements SessionGroupsRepository {
  lastQuery: SessionGroupsQuery | null = null;
  constructor(
    private readonly rows: SessionGroupRow[],
    private readonly totalHits = 0,
  ) {}
  async listSessionGroups(query: SessionGroupsQuery) {
    this.lastQuery = query;
    return {
      rows: this.rows.slice(0, query.limit),
      totalHits: this.totalHits,
    };
  }
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
        TraceSessionGroupsCursorService.decodeSessionGroupsCursor(
          TraceSessionGroupsCursorService.encodeSessionGroupsCursor(cursor),
        ),
      ).toEqual(cursor);
    });

    it("rejects malformed cursors", () => {
      expect(() =>
        TraceSessionGroupsCursorService.decodeSessionGroupsCursor("not base64 json"),
      ).toThrow("Invalid sessions cursor");
      expect(() =>
        TraceSessionGroupsCursorService.decodeSessionGroupsCursor(
          Buffer.from(JSON.stringify({ sortValue: "high" }), "utf8").toString("base64url"),
        ),
      ).toThrow("Invalid sessions cursor");
    });

    it("rejects a cursor missing the sort it was minted under", () => {
      expect(() =>
        TraceSessionGroupsCursorService.decodeSessionGroupsCursor(
          Buffer.from(JSON.stringify({ sortValue: 1, conversationId: "s-1" }), "utf8").toString(
            "base64url",
          ),
        ),
      ).toThrow("Invalid sessions cursor");
    });
  });
});

describe("SessionGroupsService", () => {
  describe("given a page of rollup rows", () => {
    it("maps every rollup field onto the DTO", async () => {
      const service = SessionGroupsService.create({
        repository: new FakeRepository([makeRow()], 1),
      });

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

  describe("when a row names its latest trace", () => {
    /** @scenario The session read carries the latest trace id onto the row */
    it("carries that trace id onto the session", async () => {
      const service = SessionGroupsService.create({
        repository: new FakeRepository([makeRow()], 1),
      });

      const result = await service.getSessionGroups({
        tenantId: TENANT,
        timeRange: { from: 0, to: 2_000_000_000_000 },
        pageSize: 10,
      });

      expect(result.sessions[0]?.lastTraceId).toBe("trace-latest");
    });

    // The rollup names a trace for every group it forms, so an empty id is a
    // gap rather than a value. Handing "" to the row would open the drawer on
    // a trace that does not exist.
    it("reports an unnamed trace as absent", async () => {
      const service = SessionGroupsService.create({
        repository: new FakeRepository([makeRow({ lastTraceId: "" })], 1),
      });

      const result = await service.getSessionGroups({
        tenantId: TENANT,
        timeRange: { from: 0, to: 2_000_000_000_000 },
        pageSize: 10,
      });

      expect(result.sessions[0]?.lastTraceId).toBeNull();
    });
  });

  describe("when the repository returns one row past the page size", () => {
    it("emits a cursor carrying the last visible row's sort value", async () => {
      const rows = [
        makeRow({ conversationId: "s-1", lastActivityMs: 300 }),
        makeRow({ conversationId: "s-2", lastActivityMs: 200 }),
        makeRow({ conversationId: "s-3", lastActivityMs: 100 }),
      ];
      const service = SessionGroupsService.create({
        repository: new FakeRepository(rows, 3),
      });

      const result = await service.getSessionGroups({
        tenantId: TENANT,
        timeRange: { from: 0, to: 2_000_000_000_000 },
        pageSize: 2,
      });

      expect(result.sessions.map((s) => s.conversationId)).toEqual(["s-1", "s-2"]);
      expect(result.nextCursor).not.toBeNull();
      expect(TraceSessionGroupsCursorService.decodeSessionGroupsCursor(result.nextCursor!)).toEqual(
        {
          sortValue: 200,
          conversationId: "s-2",
          ...CURSOR_SORT,
        },
      );
    });

    it("keys the cursor off the active sort dimension", async () => {
      const rows = [
        makeRow({ conversationId: "s-1", totalCost: 9 }),
        makeRow({ conversationId: "s-2", totalCost: 5 }),
        makeRow({ conversationId: "s-3", totalCost: 1 }),
      ];
      const repository = new FakeRepository(rows, 3);
      const service = SessionGroupsService.create({
        repository,
      });

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
      expect(TraceSessionGroupsCursorService.decodeSessionGroupsCursor(result.nextCursor!)).toEqual(
        {
          sortValue: 5,
          conversationId: "s-2",
          sortColumn: "cost",
          sortDirection: "desc",
        },
      );
    });
  });

  describe("when the sort column is unknown", () => {
    it("falls back to last activity", async () => {
      const repository = new FakeRepository([makeRow()]);
      const service = SessionGroupsService.create({
        repository,
      });

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
      const service = SessionGroupsService.create({
        repository,
      });
      const cursor = TraceSessionGroupsCursorService.encodeSessionGroupsCursor({
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
      const service = SessionGroupsService.create({
        repository,
      });
      const cursor = TraceSessionGroupsCursorService.encodeSessionGroupsCursor({
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
      const service = SessionGroupsService.create({
        repository: new FakeRepository([
          makeRow({
            lastActivityMs: 1000,
            input: "a very long captured prompt that must not leak in full",
          }),
        ]),
      });

      const result = await service.getSessionGroups({
        tenantId: TENANT,
        timeRange: { from: 0, to: 2_000_000_000_000 },
        pageSize: 10,
        visibilityCutoffMs: 2000,
      });

      const session = result.sessions[0]!;
      expect(session.input).not.toBe("a very long captured prompt that must not leak in full");
      expect(session.totalTokens).toBe(4200);
      expect(session.traceCount).toBe(3);
    });
  });
});
