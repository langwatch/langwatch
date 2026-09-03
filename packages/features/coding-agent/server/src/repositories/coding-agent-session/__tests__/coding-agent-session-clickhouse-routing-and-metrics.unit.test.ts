/**
 * Cross-tenant fan-out for the branch-list read, and the list-read cost
 * signal ADR-071 step 3's deferred pruning promise leans on.
 *
 * @see specs/coding-agent/pull-request-linkage.feature
 * @see specs/coding-agent/session-aggregate.feature
 */
import type { ClickHouseClient } from "@clickhouse/client";
import { describe, expect, it } from "vitest";
import { NoopCodingAgentReadMetricsPort } from "../../../adapters/coding-agent-read-metrics.adapter";
import { CodingAgentReadMetricsPort } from "../../../adapters/coding-agent-read-metrics.adapter";
import { CodingAgentClickHousePort } from "../../../ports/coding-agent-clickhouse.port";
import { TestClock } from "../../__tests__/fixtures/coding-agent.fixture";
import { CodingAgentSessionClickHouseRepository } from "../clickhouse.repository";

const WINDOW_FROM = new Date("2026-07-24T00:00:00.000Z").getTime();
const WINDOW_TO = new Date("2026-07-24T23:59:59.999Z").getTime();

function chTime(ms: number): string {
  const at = new Date(ms);
  const pad = (value: number, width = 2) => String(value).padStart(width, "0");
  return (
    `${at.getUTCFullYear()}-${pad(at.getUTCMonth() + 1)}-${pad(at.getUTCDate())} ` +
    `${pad(at.getUTCHours())}:${pad(at.getUTCMinutes())}:${pad(at.getUTCSeconds())}.` +
    `${pad(at.getUTCMilliseconds(), 3)}`
  );
}

function endpointClient(rows: Array<Record<string, unknown>>): {
  client: ClickHouseClient;
  sentTenantIds: () => string[][];
} {
  const sent: string[][] = [];
  const client = {
    query: async (args: { query_params: Record<string, unknown> }) => {
      sent.push(args.query_params.tenantIds as string[]);
      return { json: async () => rows };
    },
  } as unknown as ClickHouseClient;
  return { client, sentTenantIds: () => sent };
}

function branchSession({
  tenantId,
  sessionId,
  costUsd,
}: {
  tenantId: string;
  sessionId: string;
  costUsd: number;
}): Record<string, unknown> {
  return {
    TenantId: tenantId,
    SessionId: sessionId,
    StartedAt: chTime(WINDOW_FROM),
    UpdatedAt: chTime(WINDOW_FROM),
    LastEventOccurredAt: chTime(WINDOW_FROM + 60_000),
    CostUsd: costUsd,
    Agent: "claude_code",
    Models: ["claude-fable-5"],
    UserId: "agent-1",
    GitBranch: "feat/git-context",
  };
}

function makeRepository(
  resolveClient: (tenantId: string) => ClickHouseClient,
  metrics: CodingAgentReadMetricsPort = NoopCodingAgentReadMetricsPort.create(),
) {
  class RoutedPort extends CodingAgentClickHousePort {
    async resolve(tenantId: string): Promise<ClickHouseClient> {
      return resolveClient(tenantId);
    }
  }
  return CodingAgentSessionClickHouseRepository.create({
    clickHouse: new RoutedPort(),
    defaultTraceRetentionDays: 30,
    metrics,
    clock: new TestClock(),
  });
}

describe("CodingAgentSessionClickHouseRepository branch-list routing", () => {
  describe("given tenants that resolve to two different endpoints", () => {
    describe("when the repository's branch sessions are listed", () => {
      it("queries each endpoint for its own tenants and returns both answers", async () => {
        const first = endpointClient([
          branchSession({ tenantId: "tenant-a", sessionId: "session-a", costUsd: 3 }),
        ]);
        const second = endpointClient([
          branchSession({ tenantId: "tenant-b", sessionId: "session-b", costUsd: 4 }),
        ]);
        const repository = makeRepository((tenantId) =>
          tenantId === "tenant-a" ? first.client : second.client,
        );

        const listed = await repository.listByRepositoryBranch({
          tenantIds: ["tenant-a", "tenant-b"],
          repositoryHost: "github.com",
          repositoryOwner: "acme",
          repositoryName: "widgets",
          branches: ["feat/git-context"],
          startedAtFromMs: WINDOW_FROM,
        });

        expect(first.sentTenantIds()).toEqual([["tenant-a"]]);
        expect(second.sentTenantIds()).toEqual([["tenant-b"]]);
        expect(listed.map((row) => row.sessionId)).toEqual(["session-a", "session-b"]);
        expect(listed.map((row) => row.costUsd)).toEqual([3, 4]);
        expect(listed.map((row) => row.lastEventOccurredAtMs)).toEqual([
          WINDOW_FROM + 60_000,
          WINDOW_FROM + 60_000,
        ]);
      });
    });
  });

  describe("given tenants that all resolve to one endpoint", () => {
    describe("when the repository's branch sessions are listed", () => {
      it("asks for all of them in a single query", async () => {
        const only = endpointClient([]);
        const repository = makeRepository(() => only.client);

        await repository.listByRepositoryBranch({
          tenantIds: ["tenant-a", "tenant-b"],
          repositoryHost: "github.com",
          repositoryOwner: "acme",
          repositoryName: "widgets",
          branches: ["feat/git-context"],
          startedAtFromMs: WINDOW_FROM,
        });

        expect(only.sentTenantIds()).toEqual([["tenant-a", "tenant-b"]]);
      });
    });
  });
});

/**
 * A fake metrics port that just counts observations per outcome, rather than
 * the prom-client registry main pinned this against — the read now reaches
 * ClickHouse through an injected `CodingAgentReadMetricsPort`, so this is the
 * seam the package's own tests observe it at.
 */
class CountingReadMetricsPort extends CodingAgentReadMetricsPort {
  counts = { hit: 0, empty: 0, error: 0 };

  observeSessionListRead(input: { outcome: "hit" | "empty" | "error" }): void {
    this.counts[input.outcome] += 1;
  }
}

function version({
  sessionId,
  startedAtMs,
  costUsd,
}: {
  sessionId: string;
  startedAtMs: number;
  costUsd: number;
}): Record<string, unknown> {
  return {
    TenantId: "tenant-1",
    SessionId: sessionId,
    UserId: "user-1",
    StartedAt: chTime(startedAtMs),
    UpdatedAt: chTime(startedAtMs),
    CostUsd: costUsd,
  };
}

function listClient(rows: Array<Record<string, unknown>>): ClickHouseClient {
  return {
    query: async () => ({ json: async () => rows }),
  } as unknown as ClickHouseClient;
}

/**
 * ADR-071 sequencing step 2 traded partition pruning on the dedup scope for a
 * correct answer, and step 3's freeze — the thing that buys the pruning back —
 * is deferred on the claim that the unpruned scan stays cheap. These pin the
 * only evidence that claim will ever have.
 */
describe("CodingAgentSessionClickHouseRepository list-read cost signal", () => {
  describe("given a window holding a session", () => {
    describe("when the window is listed", () => {
      it("times the read under the hit outcome", async () => {
        const metrics = new CountingReadMetricsPort();
        const repository = makeRepository(
          () =>
            listClient([
              version({ sessionId: "listed", startedAtMs: WINDOW_FROM + 10 * 60_000, costUsd: 2 }),
            ]),
          metrics,
        );

        await repository.findManyRecent({
          tenantId: "tenant-1",
          fromMs: WINDOW_FROM,
          toMs: WINDOW_TO,
          limit: 50,
        });

        expect(metrics.counts.hit).toBe(1);
        expect(metrics.counts.empty).toBe(0);
      });
    });
  });

  describe("given a window holding no sessions", () => {
    describe("when the window is listed", () => {
      it("times the read under the empty outcome, which is where the unpruned scan shows up alone", async () => {
        const metrics = new CountingReadMetricsPort();
        const repository = makeRepository(() => listClient([]), metrics);

        await repository.findManyRecent({
          tenantId: "tenant-1",
          fromMs: WINDOW_FROM,
          toMs: WINDOW_TO,
          limit: 50,
        });

        expect(metrics.counts.empty).toBe(1);
        expect(metrics.counts.hit).toBe(0);
      });
    });
  });

  describe("given a read that fails", () => {
    describe("when the window is listed", () => {
      it("times the failure under the error outcome and still raises it", async () => {
        const metrics = new CountingReadMetricsPort();
        const failing = {
          query: async () => {
            throw new Error("clickhouse unavailable");
          },
        } as unknown as ClickHouseClient;
        const repository = makeRepository(() => failing, metrics);

        await expect(
          repository.findManyRecent({
            tenantId: "tenant-1",
            fromMs: WINDOW_FROM,
            toMs: WINDOW_TO,
            limit: 50,
          }),
        ).rejects.toThrow("clickhouse unavailable");

        expect(metrics.counts.error).toBe(1);
        expect(metrics.counts.hit).toBe(0);
      });
    });
  });
});
