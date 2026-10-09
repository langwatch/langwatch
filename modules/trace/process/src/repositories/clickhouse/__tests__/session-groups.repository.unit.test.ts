/**
 * The Sessions lens rollup reads through the proof's fence (ADR-175): every statement carries the
 * fence and names no tenant, and a session is a conversation within one tenant.
 */
import { aggregateProof, ownProof } from "@langwatch/authorization/testing";
import { type QueryRequest, TenantGuard } from "@langwatch/clickhouse-client";
import { describe, expect, it } from "vitest";

import type { SessionGroupsQuery } from "../../session-groups.repository.ts";
import { AuthorizedTraceReadsRepository } from "../clickhouse.trace-member-client.repository.ts";
import { SessionGroupsClickHouseRepository } from "../session-groups.repository.ts";

const NOW = Date.now();

const rollupRow = {
  TenantId: "member-a",
  ConversationId: "session-1",
  TraceCount: "1",
  SessionCost: 1,
  SessionTokens: "10",
  SessionCacheReadTokens: "0",
  SessionCacheCreationTokens: "0",
  MaxContextSizeTokens: "0",
  SessionDurationMs: 100,
  StartedAtMs: String(NOW),
  LastActivityMs: String(NOW),
  SessionModels: [],
  PrimaryModels: [],
  SessionServices: [],
  SessionErrorCount: "0",
  SessionWarningCount: "0",
  SessionSpans: "1",
  LastTraceId: "trace-1",
};

function recording(answer: (sql: string) => unknown[]) {
  const sent: QueryRequest[] = [];
  const repository = SessionGroupsClickHouseRepository.create({
    reads: AuthorizedTraceReadsRepository.create({
      clickhouse: {
        query: async <Row>(request: QueryRequest) => {
          sent.push(request);
          return { rows: answer(request.sql) as Row[] };
        },
      },
    }),
  });
  return { repository, sent };
}

function answer(sql: string): unknown[] {
  if (sql.includes("totalHits")) return [{ totalHits: "1" }];
  if (sql.includes("ComputedInput")) {
    return [
      { TenantId: "member-b", TraceId: "trace-1", ComputedInput: "not mine", ComputedOutput: null },
      { TenantId: "member-a", TraceId: "trace-1", ComputedInput: "mine", ComputedOutput: null },
    ];
  }
  return [rollupRow];
}

function query(overrides: Partial<SessionGroupsQuery> = {}): SessionGroupsQuery {
  return {
    authorization: ownProof({ projectId: "project-1", now: NOW }),
    timeRange: { from: NOW - 60_000, to: NOW + 60_000 },
    sort: { column: "lastActivity", direction: "desc" },
    limit: 10,
    ...overrides,
  };
}

describe("SessionGroupsClickHouseRepository.listSessionGroups", () => {
  describe("given a plain project's proof and a transcript search", () => {
    it("fences every statement and binds no tenant of its own", async () => {
      const { repository, sent } = recording(answer);

      await repository.listSessionGroups(query({ contentTerms: ["needle"] }));

      expect(sent).toHaveLength(3);
      for (const request of sent) {
        expect(request.params).not.toHaveProperty("tenantId");
        expect(request.params?.tenantScope_all).toEqual(["project-1"]);
        expect(request.sql).not.toContain("{tenantId:String}");
      }
      const rollup = sent[0]!.sql;
      expect(rollup).toContain("GROUP BY TenantId, ConversationId");
      expect(rollup).toContain("(TenantId, Attributes['gen_ai.conversation.id']) IN (");
    });
  });

  describe("given an aggregate's members sharing a trace id", () => {
    it("names the session's tenant and reads its own preview", async () => {
      const { repository } = recording(answer);

      const page = await repository.listSessionGroups(
        query({
          authorization: aggregateProof({
            projectId: "aggregate",
            members: [
              { projectId: "member-a", from: 0 },
              { projectId: "member-b", from: 0 },
            ],
            now: NOW,
          }),
        }),
      );

      expect(page.rows[0]).toMatchObject({ tenantId: "member-a", input: "mine" });
    });
  });

  describe("given a cursor that carries the boundary session's tenant", () => {
    it("breaks the tie on conversation id and tenant together", async () => {
      const { repository, sent } = recording(answer);

      await repository.listSessionGroups(
        query({ cursor: { sortValue: NOW, conversationId: "session-1", tenantId: "member-a" } }),
      );

      expect(sent[0]!.sql).toContain(
        "(ConversationId, TenantId) > ({cursorConversationId:String}, {cursorTenantId:String})",
      );
      expect(sent[0]!.params).toMatchObject({ cursorTenantId: "member-a" });
    });

    it("keeps the keyset disjunction where the tenant guard accepts it", async () => {
      const { repository, sent } = recording(answer);

      await repository.listSessionGroups(
        query({ cursor: { sortValue: NOW, conversationId: "session-1", tenantId: "member-a" } }),
      );

      for (const request of sent) {
        expect(() => new TenantGuard().assert(request)).not.toThrow();
      }
    });
  });
});
