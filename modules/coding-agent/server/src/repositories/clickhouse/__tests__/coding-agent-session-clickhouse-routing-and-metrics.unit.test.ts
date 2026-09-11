/**
 * How the branch-list read names its tenants, and the list-read cost signal
 * ADR-071 step 3's deferred pruning promise leans on.
 * @see specs/coding-agent/session-aggregate.feature
 */
import type { ClickHouseQueryClient } from "@langwatch/clickhouse-client";
import { describe, expect, it } from "vitest";
import { NoopCodingAgentReadMetrics } from "../../../services/coding-agent-read-metrics-noop.service.ts";
import { CodingAgentReadMetrics } from "../../../app/coding-agent.members.ts";
import { TestClock } from "../../../__tests__/fixtures/coding-agent.fixture.ts";
import { CodingAgentSessionClickHouseRepository } from "../clickhouse.coding-agent-session.repository.ts";

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

/**
 * The process's one client, stood in for. It records the tenant each statement
 * NAMED — what the real client routes by — beside the tenant list the statement
 * scoped itself to.
 */
function recordingClient(rows: Array<Record<string, unknown>>): {
  client: ClickHouseQueryClient;
  named: () => string[];
  scopedTo: () => string[][];
} {
  const named: string[] = [];
  const scopedTo: string[][] = [];
  const client = {
    query: async (request: { tenantId: string; params?: Record<string, unknown> }) => {
      named.push(request.tenantId);
      scopedTo.push((request.params?.tenantIds ?? []) as string[]);
      return { rows };
    },
  } as unknown as ClickHouseQueryClient;
  return { client, named: () => named, scopedTo: () => scopedTo };
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
  clickhouse: ClickHouseQueryClient,
  metrics: CodingAgentReadMetrics = NoopCodingAgentReadMetrics.create(),
) {
  return CodingAgentSessionClickHouseRepository.create({
    clickhouse,
    defaultTraceRetentionDays: 30,
    metrics,
    clock: new TestClock(),
  });
}

const listBranch = (repository: ReturnType<typeof makeRepository>) =>
  repository.listByRepositoryBranch({
    tenantIds: ["tenant-a", "tenant-b"],
    repositoryHost: "github.com",
    repositoryOwner: "acme",
    repositoryName: "widgets",
    branches: ["feat/git-context"],
    startedAtFromMs: WINDOW_FROM,
  });

describe("CodingAgentSessionClickHouseRepository branch-list read", () => {
  describe("given an organization's project tenants", () => {
    describe("when the repository's branch sessions are listed", () => {
      it("reads them in one statement scoped to the whole list", async () => {
        const endpoint = recordingClient([]);

        await listBranch(makeRepository(endpoint.client));

        expect(endpoint.scopedTo()).toEqual([["tenant-a", "tenant-b"]]);
      });

      it("names one of those tenants, so the client routes the statement to their server", async () => {
        const endpoint = recordingClient([]);

        await listBranch(makeRepository(endpoint.client));

        expect(endpoint.named()).toEqual(["tenant-a"]);
      });

      it("returns every tenant's sessions from that one answer", async () => {
        const endpoint = recordingClient([
          branchSession({ tenantId: "tenant-a", sessionId: "session-a", costUsd: 3 }),
          branchSession({ tenantId: "tenant-b", sessionId: "session-b", costUsd: 4 }),
        ]);

        const listed = await listBranch(makeRepository(endpoint.client));

        expect(listed.map((row) => row.sessionId)).toEqual(["session-a", "session-b"]);
        expect(listed.map((row) => row.costUsd)).toEqual([3, 4]);
        expect(listed.map((row) => row.lastEventOccurredAtMs)).toEqual([
          WINDOW_FROM + 60_000,
          WINDOW_FROM + 60_000,
        ]);
      });
    });
  });
});

/**
 * A fake metrics port that just counts observations per outcome, rather than the
 * prom-client registry main pinned this against — the read now reaches ClickHouse through
 * an injected `CodingAgentReadMetrics`, so this is the seam the package's own tests
 */
class CountingReadMetrics implements CodingAgentReadMetrics {
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

function listClient(rows: Array<Record<string, unknown>>): ClickHouseQueryClient {
  return {
    query: async () => ({ rows }),
  } as unknown as ClickHouseQueryClient;
}

/**
 * ADR-071 sequencing step 2 traded partition pruning on the dedup scope for a
 * correct answer, and step 3's freeze — the thing that buys the pruning back — is deferred
 * on the claim that the unpruned scan stays cheap.
 */
describe("CodingAgentSessionClickHouseRepository list-read cost signal", () => {
  describe("given a window holding a session", () => {
    describe("when the window is listed", () => {
      it("times the read under the hit outcome", async () => {
        const metrics = new CountingReadMetrics();
        const repository = makeRepository(
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
        const metrics = new CountingReadMetrics();
        const repository = makeRepository(listClient([]), metrics);

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
        const metrics = new CountingReadMetrics();
        const failing = {
          query: async () => {
            throw new Error("clickhouse unavailable");
          },
        } as unknown as ClickHouseQueryClient;
        const repository = makeRepository(failing, metrics);

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
