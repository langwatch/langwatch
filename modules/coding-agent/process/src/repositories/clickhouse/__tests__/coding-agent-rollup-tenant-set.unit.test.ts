/**
 * The pull-request rollups read one organization's project tenants as a declared tenant set.
 * @see specs/coding-agent/pull-request-linkage.feature
 */
import { TenantGuard, type QueryRequest } from "@langwatch/clickhouse-client";
import type { ReaderReadStatement } from "@langwatch/clickhouse-client/builder";
import { clickHouseQueryClientDouble } from "@langwatch/test-harness/client-doubles/clickhouse";
import { describe, expect, it } from "vitest";

import { TestClock } from "../../../__tests__/fixtures/coding-agent.fixture.ts";
import { NoopCodingAgentReadMetricsService } from "../../../__tests__/support/coding-agent-read-metrics-noop.service.ts";
import { sessionIdIndexNotReady } from "../../../__tests__/support/session-id-index-not-ready.fixture.ts";
import { CodingAgentSessionEventsClickHouseRepository } from "../clickhouse.coding-agent-session-event.repository.ts";
import { CodingAgentSessionClickHouseRepository } from "../clickhouse.coding-agent-session.repository.ts";

const TENANTS = ["tenant-a", "tenant-b"];
const REPOSITORY = { repositoryHost: "github.com", repositoryOwner: "acme", repositoryName: "app" };

function guardedClient() {
  const guard = new TenantGuard();
  const requests: QueryRequest[] = [];
  const statements: ReaderReadStatement[] = [];
  const clickhouse = clickHouseQueryClientDouble({
    ...sessionIdIndexNotReady,
    read: async (request: { statement: unknown }) => {
      const statement = request.statement as ReaderReadStatement;
      statements.push(statement);
      return { rows: [] };
    },
    query: async (request: QueryRequest) => {
      guard.assert(request);
      requests.push(request);
      return { rows: [] };
    },
  });
  return { clickhouse, requests, statements };
}

describe("coding-agent pull-request rollups", () => {
  describe("when they read an organization's project tenants together", () => {
    it("declares the tenant set and passes the tenant guard without skipping it", async () => {
      const { clickhouse, requests, statements } = guardedClient();
      const events = CodingAgentSessionEventsClickHouseRepository.create({
        clickhouse,
        defaultTraceRetentionDays: 30,
      });
      const sessions = CodingAgentSessionClickHouseRepository.create({
        clickhouse,
        defaultTraceRetentionDays: 30,
        metrics: NoopCodingAgentReadMetricsService.create(),
        clock: new TestClock(),
      });

      await events.sumTokensByModelPerSession({ tenantIds: TENANTS, sessionIds: ["s"], fromMs: 0 });
      await events.findSessionsByStampedBranch({
        tenantIds: TENANTS,
        ...REPOSITORY,
        branches: ["main"],
        fromMs: 0,
      });
      await sessions.findByRepositoryBranch({
        tenantIds: TENANTS,
        ...REPOSITORY,
        branches: ["main"],
        startedAtFromMs: 0,
      });
      await sessions.findBySessionIds({
        tenantIds: TENANTS,
        sessionIds: ["s"],
        startedAtFromMs: 0,
      });

      expect(requests).toHaveLength(2);
      for (const request of requests) {
        expect(request.tenantIds).toEqual(TENANTS);
        expect(request.SKIP_TENANT_CHECK).toBeUndefined();
      }
      expect(statements).toHaveLength(2);
      for (const statement of statements) {
        expect(statement).toMatchObject({ identity: "reader", kind: "tenant" });
        expect(statement.settings).toMatchObject({ SQL_langwatch_tenant_ids: TENANTS.join(",") });
      }
    });
  });
});
