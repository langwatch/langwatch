import { describe, expect, it } from "vitest";
import type {
  OutboxInsertRow,
  OutboxLeaseQuery,
  OutboxListQuery,
  OutboxRepository,
  OutboxRetryUpdate,
} from "../outbox.repository";
import { OutboxService } from "../outbox.service";
import type { OutboxRow } from "../outbox.types";

/**
 * In-memory fake — exercises the service contract without touching
 * PG. Lease selection is not concurrency-safe; the integration test
 * covers the real `FOR UPDATE SKIP LOCKED` race.
 */
class InMemoryOutboxRepository implements OutboxRepository {
  rows: OutboxRow[] = [];
  private nextId = 1;

  async insertIfAbsent(row: OutboxInsertRow): Promise<boolean> {
    const existing = this.rows.find(
      (r) => r.reactorName === row.reactorName && r.dedupKey === row.dedupKey,
    );
    if (existing) return false;
    // Always-ready (`new Date(0)`) so the service's injected clock
    // alone decides when a row becomes claimable. The real Prisma
    // path uses CURRENT_TIMESTAMP, but that conflates the service
    // clock with PG's clock and is what integration tests cover.
    const alwaysReady = new Date(0);
    this.rows.push({
      id: `row-${this.nextId++}`,
      projectId: row.projectId,
      reactorName: row.reactorName,
      dedupKey: row.dedupKey,
      groupKey: row.groupKey,
      payload: row.payload as object,
      status: "queued",
      attempts: 0,
      maxAttempts: row.maxAttempts ?? 8,
      leasedUntil: null,
      nextAttemptAt: alwaysReady,
      lastError: null,
      lastErrorAt: null,
      renderDiagnostics: null,
      dispatchedAt: null,
      createdAt: alwaysReady,
      updatedAt: alwaysReady,
    });
    return true;
  }

  async leaseNext(query: OutboxLeaseQuery): Promise<OutboxRow | null> {
    const candidate = this.rows.find(
      (r) =>
        r.projectId === query.projectId &&
        r.reactorName === query.reactorName &&
        (r.status === "queued" || r.status === "failed_retryable") &&
        r.nextAttemptAt !== null &&
        r.nextAttemptAt <= query.now,
    );
    if (!candidate) return null;
    candidate.status = "dispatching";
    candidate.leasedUntil = query.leasedUntil;
    candidate.attempts += 1;
    candidate.updatedAt = query.now;
    return { ...candidate };
  }

  async recoverExpiredLeases({
    now,
    limit,
  }: {
    now: Date;
    limit: number;
  }): Promise<number> {
    const expired = this.rows
      .filter(
        (r) =>
          r.status === "dispatching" &&
          r.leasedUntil !== null &&
          r.leasedUntil < now,
      )
      .slice(0, limit);
    for (const r of expired) {
      r.status = "queued";
      r.leasedUntil = null;
      r.updatedAt = now;
    }
    return expired.length;
  }

  async markDispatched({
    rowId,
    projectId,
    now,
  }: {
    rowId: string;
    projectId: string;
    now: Date;
  }): Promise<void> {
    // Mirror the prisma CAS: only a still-`dispatching` row owned by
    // the project transitions.
    const row = this.rows.find(
      (r) =>
        r.id === rowId &&
        r.projectId === projectId &&
        r.status === "dispatching",
    );
    if (!row) return;
    row.status = "dispatched";
    row.leasedUntil = null;
    row.dispatchedAt = now;
    row.updatedAt = now;
  }

  async markRetry(update: OutboxRetryUpdate): Promise<void> {
    // Conditional CAS on (projectId, status `dispatching`, attempts) —
    // a stale write no-ops instead of clobbering a re-leased row.
    const row = this.rows.find(
      (r) =>
        r.id === update.rowId &&
        r.projectId === update.projectId &&
        r.status === "dispatching" &&
        r.attempts === update.attempts,
    );
    if (!row) return;
    row.status = update.status;
    row.nextAttemptAt = update.nextAttemptAt;
    row.leasedUntil = null;
    row.lastError = update.lastError;
    row.lastErrorAt = update.lastErrorAt;
    row.updatedAt = update.lastErrorAt;
  }

  async findById({
    rowId,
    projectId,
  }: {
    rowId: string;
    projectId: string;
  }): Promise<OutboxRow | null> {
    return (
      this.rows.find((r) => r.id === rowId && r.projectId === projectId) ?? null
    );
  }

  async list(query: OutboxListQuery): Promise<OutboxRow[]> {
    return this.rows
      .filter(
        (r) =>
          r.projectId === query.projectId &&
          (query.reactorName ? r.reactorName === query.reactorName : true) &&
          (query.status ? r.status === query.status : true),
      )
      .slice(0, query.limit);
  }
}

function buildService({
  random = () => 1,
  now,
}: {
  random?: () => number;
  now?: () => Date;
} = {}) {
  const repo = new InMemoryOutboxRepository();
  const service = new OutboxService(repo, {
    backoff: { baseMs: 1000, random },
    now,
  });
  return { repo, service };
}

describe("OutboxService", () => {
  describe("enqueue", () => {
    describe("when no row exists for (reactorName, dedupKey)", () => {
      it("inserts a queued row", async () => {
        const { repo, service } = buildService();
        const result = await service.enqueue({
          projectId: "proj1",
          reactorName: "alertDispatch",
          dedupKey: "proj1/trigger1:trace1",
          groupKey: "proj1/alertDispatch:trigger1",
          payload: { triggerId: "trigger1" },
        });
        expect(result.enqueued).toBe(true);
        expect(repo.rows).toHaveLength(1);
        expect(repo.rows[0]!.status).toBe("queued");
      });
    });

    describe("when a row already exists for (reactorName, dedupKey)", () => {
      it("returns enqueued: false without inserting", async () => {
        const { repo, service } = buildService();
        await service.enqueue({
          projectId: "proj1",
          reactorName: "alertDispatch",
          dedupKey: "proj1/trigger1:trace1",
          groupKey: "proj1/alertDispatch:trigger1",
          payload: {},
        });
        const second = await service.enqueue({
          projectId: "proj1",
          reactorName: "alertDispatch",
          dedupKey: "proj1/trigger1:trace1",
          groupKey: "proj1/alertDispatch:trigger1",
          payload: {},
        });
        expect(second.enqueued).toBe(false);
        expect(repo.rows).toHaveLength(1);
      });
    });

    describe("when groupKey does not start with `${projectId}/`", () => {
      it("throws so the contract violation surfaces at enqueue (ADR-030)", async () => {
        const { service } = buildService();
        await expect(
          service.enqueue({
            projectId: "proj1",
            reactorName: "alertDispatch",
            dedupKey: "proj1/trigger1:trace1",
            groupKey: "alertDispatch:trigger1",
            payload: {},
          }),
        ).rejects.toThrow(/must start with "proj1\/"/);
      });

      it("also rejects a groupKey for a different project", async () => {
        const { service } = buildService();
        await expect(
          service.enqueue({
            projectId: "proj1",
            reactorName: "alertDispatch",
            dedupKey: "proj1/trigger1:trace1",
            groupKey: "proj2/alertDispatch:trigger1",
            payload: {},
          }),
        ).rejects.toThrow(/must start with "proj1\/"/);
      });
    });

    describe("when dedupKey does not start with `${projectId}/`", () => {
      it("throws so a forgotten tenant prefix cannot suppress another project's row", async () => {
        const { service } = buildService();
        await expect(
          service.enqueue({
            projectId: "proj1",
            reactorName: "alertDispatch",
            dedupKey: "trigger1:trace1",
            groupKey: "proj1/alertDispatch:trigger1",
            payload: {},
          }),
        ).rejects.toThrow(/dedupKey must start with "proj1\/"/);
      });
    });
  });

  describe("leaseNext", () => {
    describe("when a queued row is past its nextAttemptAt", () => {
      it("flips it to dispatching with a leasedUntil in the future", async () => {
        const fixedNow = new Date("2026-05-28T12:00:00Z");
        const { service } = buildService({ now: () => fixedNow });
        await service.enqueue({
          projectId: "proj1",
          reactorName: "alertDispatch",
          dedupKey: "proj1/k",
          groupKey: "proj1/alertDispatch:trigger1",
          payload: {},
        });
        const row = await service.leaseNext({
          projectId: "proj1",
          reactorName: "alertDispatch",
          leaseDurationMs: 30_000,
        });
        expect(row?.status).toBe("dispatching");
        expect(row?.leasedUntil?.getTime()).toBe(fixedNow.getTime() + 30_000);
        expect(row?.attempts).toBe(1);
      });
    });

    describe("when no claimable row exists", () => {
      it("returns null", async () => {
        const { service } = buildService();
        const row = await service.leaseNext({
          projectId: "proj1",
          reactorName: "alertDispatch",
          leaseDurationMs: 30_000,
        });
        expect(row).toBeNull();
      });
    });
  });

  describe("markFailedRetryable", () => {
    describe("when attempts remain", () => {
      it("schedules a backoff retry and increments attempts", async () => {
        const fixedNow = new Date("2026-05-28T12:00:00Z");
        const { repo, service } = buildService({
          now: () => fixedNow,
          random: () => 1,
        });
        await service.enqueue({
          projectId: "proj1",
          reactorName: "alertDispatch",
          dedupKey: "proj1/k",
          groupKey: "proj1/alertDispatch:trigger1",
          payload: {},
        });
        const leased = await service.leaseNext({
          projectId: "proj1",
          reactorName: "alertDispatch",
          leaseDurationMs: 30_000,
        });
        const result = await service.markFailedRetryable({
          row: leased!,
          error: "transient",
        });
        expect(result.status).toBe("failed_retryable");
        expect(result.nextAttemptAt?.getTime()).toBe(fixedNow.getTime() + 1000);
        const fresh = repo.rows[0]!;
        expect(fresh.status).toBe("failed_retryable");
        expect(fresh.attempts).toBe(1);
        expect(fresh.lastError).toBe("transient");
        expect(fresh.leasedUntil).toBeNull();
      });
    });

    describe("when attempts have reached maxAttempts", () => {
      it("promotes to dead instead of scheduling another retry", async () => {
        const { repo, service } = buildService();
        await service.enqueue({
          projectId: "proj1",
          reactorName: "alertDispatch",
          dedupKey: "proj1/k",
          groupKey: "proj1/alertDispatch:trigger1",
          payload: {},
          maxAttempts: 1,
        });
        const leased = await service.leaseNext({
          projectId: "proj1",
          reactorName: "alertDispatch",
          leaseDurationMs: 30_000,
        });
        const result = await service.markFailedRetryable({
          row: leased!,
          error: "still broken",
        });
        expect(result.status).toBe("dead");
        expect(result.nextAttemptAt).toBeNull();
        expect(repo.rows[0]!.status).toBe("dead");
      });
    });
  });

  describe("markDead", () => {
    describe("when called on an in-flight row", () => {
      it("flips it to dead regardless of attempts", async () => {
        const { repo, service } = buildService();
        await service.enqueue({
          projectId: "proj1",
          reactorName: "alertDispatch",
          dedupKey: "proj1/k",
          groupKey: "proj1/alertDispatch:trigger1",
          payload: {},
        });
        const leased = await service.leaseNext({
          projectId: "proj1",
          reactorName: "alertDispatch",
          leaseDurationMs: 30_000,
        });
        await service.markDead({ row: leased!, error: "unrecoverable" });
        expect(repo.rows[0]!.status).toBe("dead");
        expect(repo.rows[0]!.lastError).toBe("unrecoverable");
      });
    });
  });

  describe("recoverStuckLeases", () => {
    describe("when a leased row's leasedUntil has passed", () => {
      it("resets it to queued", async () => {
        const past = new Date("2026-05-28T11:00:00Z");
        const future = new Date("2026-05-28T12:00:00Z");
        let now = past;
        const { repo, service } = buildService({ now: () => now });
        await service.enqueue({
          projectId: "proj1",
          reactorName: "alertDispatch",
          dedupKey: "proj1/k",
          groupKey: "proj1/alertDispatch:trigger1",
          payload: {},
        });
        await service.leaseNext({
          projectId: "proj1",
          reactorName: "alertDispatch",
          leaseDurationMs: 1_000,
        });
        now = future;
        const recovered = await service.recoverStuckLeases({ limit: 10 });
        expect(recovered).toBe(1);
        expect(repo.rows[0]!.status).toBe("queued");
      });
    });
  });
});
