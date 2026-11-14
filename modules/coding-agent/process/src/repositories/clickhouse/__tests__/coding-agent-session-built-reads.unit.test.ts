/**
 * ADR-202: every coding-agent session read is a built statement, sent as the reader with the
 * tenant setting the row policy reads, under the scope its callers hold.
 */
import type { ReaderReadStatement } from "@langwatch/clickhouse-client/builder";
import { describe, expect, it } from "vitest";

import { TestClock, aggregateProof } from "../../../__tests__/fixtures/coding-agent.fixture.ts";
import { NoopCodingAgentReadMetricsService } from "../../../__tests__/support/coding-agent-read-metrics-noop.service.ts";
import { CodingAgentSessionClickHouseRepository } from "../clickhouse.coding-agent-session.repository.ts";

/** One row every read here can parse: an index span, a usage count and a first session. */
const ANSWER = { n: 1, fromMs: 1_000, toMs: 2_000, Sessions: 1, Versions: 1, FirstMs: 1_000 };

function recordingRepository() {
  const statements: ReaderReadStatement[] = [];
  const clickhouse = {
    read: async ({ statement }: { statement: ReaderReadStatement }) => {
      statements.push(statement);
      return { rows: [ANSWER] };
    },
    insert: async () => undefined,
    targetOf: async () => "shared",
    idIndexes: () => ({ isReady: () => true }),
  } as never;
  const repository = CodingAgentSessionClickHouseRepository.create({
    clickhouse,
    defaultTraceRetentionDays: 30,
    metrics: NoopCodingAgentReadMetricsService.create(),
    clock: new TestClock(),
  });
  return { repository, statements };
}

const expectReaderReads = ({
  statements,
  tenantIds,
}: {
  statements: ReaderReadStatement[];
  tenantIds: string[];
}) => {
  expect(statements.length).toBeGreaterThan(0);
  for (const statement of statements) {
    expect(statement).toMatchObject({ identity: "reader", kind: "tenant" });
    expect(statement.settings).toMatchObject({ SQL_langwatch_tenant_ids: tenantIds.join(",") });
  }
};

describe("coding-agent session built reads", () => {
  describe("when one project's sessions are read", () => {
    it("scopes the point read, the list, the probes and the usage counts to that project", async () => {
      const { repository, statements } = recordingRepository();

      await repository.findBySessionId({ tenantId: "project_1", sessionId: "session_1" });
      await repository.findBySessionId({
        tenantId: "project_1",
        sessionId: "session_1",
        window: { fromMs: 1_000, toMs: 2_000 },
      });
      await repository.findManyRecent({
        tenantId: "project_1",
        userId: "user_1",
        fromMs: 1_000,
        toMs: 2_000,
        limit: 5,
      });
      await repository.findOtherSessionKind({ tenantId: "project_1", excludeSessionIds: ["s"] });
      await repository.countUsage({ projectIds: ["project_1"], since: 1_000 });

      expectReaderReads({ statements, tenantIds: ["project_1"] });
      expect(statements.every((each) => each.sql.includes("TenantId = {tenantId:String}"))).toBe(
        true,
      );
      expect(
        statements.some((each) => each.sql.includes("FROM coding_agent_sessions_id_index")),
      ).toBe(true);
    });
  });

  describe("when an organization's project tenants are read together", () => {
    it("scopes the branch and by-id reads to the declared tenant set", async () => {
      const { repository, statements } = recordingRepository();
      const tenantIds = ["project_1", "project_2"];

      await repository.findByRepositoryBranch({
        tenantIds,
        repositoryHost: "github.com",
        repositoryOwner: "acme",
        repositoryName: "app",
        branches: ["main"],
        startedAtFromMs: 1_000,
      });
      await repository.findBySessionIds({ tenantIds, sessionIds: ["s"], startedAtFromMs: 1_000 });

      expectReaderReads({ statements, tenantIds });
      expect(
        statements.every((each) => each.sql.includes("TenantId IN ({tenantIds:Array(String)})")),
      ).toBe(true);
    });
  });

  describe("when a page is read through a proof", () => {
    it("scopes it to the fence's tenants and windows the page and its election", async () => {
      const { repository, statements } = recordingRepository();

      await repository.findManyRecentFenced({
        authorization: aggregateProof({
          projectId: "aggregate",
          members: [{ projectId: "member-a", from: 1_000 }],
        }),
        fromMs: 1_000,
        toMs: 2_000,
        limit: 5,
      });

      expectReaderReads({ statements, tenantIds: ["aggregate", "member-a"] });
      const page = statements.at(-1);
      expect(page?.sql).toMatch(/WITH latest AS \(.*transform\(TenantId.*StartedAt.*\) SELECT/s);
    });
  });
});
