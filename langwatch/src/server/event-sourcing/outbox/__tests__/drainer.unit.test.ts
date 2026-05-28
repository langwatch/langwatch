import { beforeEach, describe, expect, it, vi } from "vitest";
import { DispatchError } from "../dispatchError";
import { OutboxDrainer } from "../drainer";
import { OutboxService } from "../outbox.service";
import type { OutboxRepository } from "../outbox.repository";
import type { OutboxRow } from "../outbox.types";
import type { OutboxWakeup } from "../wakeupQueue";

class StubRepository implements OutboxRepository {
  rows: OutboxRow[] = [];
  insertIfAbsent = vi.fn(async () => true);
  leaseNext = vi.fn(async () => null as OutboxRow | null);
  recoverExpiredLeases = vi.fn(async () => 0);
  markDispatched = vi.fn(async () => undefined);
  markRetry = vi.fn(async () => undefined);
  findById = vi.fn(async (id: string) =>
    this.rows.find((r) => r.id === id) ?? null,
  );
  list = vi.fn(async () => [] as OutboxRow[]);
}

function makeRow(overrides: Partial<OutboxRow> = {}): OutboxRow {
  const now = new Date("2026-05-28T12:00:00Z");
  return {
    id: "row-1",
    projectId: "proj1",
    reactorName: "alertDispatch",
    dedupKey: "trigger1:trace:trace1",
    groupKey: "proj1/alertDispatch:trigger1",
    payload: {},
    status: "dispatching",
    attempts: 1,
    maxAttempts: 8,
    leasedUntil: now,
    nextAttemptAt: now,
    lastError: null,
    lastErrorAt: null,
    dispatchedAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

const baseWakeup: OutboxWakeup = {
  reactorName: "alertDispatch",
  groupKey: "proj1/alertDispatch:trigger1",
  scheduledAt: Date.now(),
};

describe("OutboxDrainer.handleWakeup", () => {
  let repo: StubRepository;
  let service: OutboxService;
  let scheduleWakeup: ReturnType<typeof vi.fn>;
  let drainer: OutboxDrainer;

  beforeEach(() => {
    repo = new StubRepository();
    service = new OutboxService(repo);
    scheduleWakeup = vi.fn(async () => undefined);
    drainer = new OutboxDrainer(service, {
      scheduleWakeup,
      maxRowsPerWakeup: 3,
    });
  });

  describe("when no dispatcher is registered for the wakeup", () => {
    it("returns without leasing or calling scheduleWakeup", async () => {
      await drainer.handleWakeup(baseWakeup);
      expect(repo.leaseNext).not.toHaveBeenCalled();
      expect(scheduleWakeup).not.toHaveBeenCalled();
    });
  });

  describe("when the wakeup groupKey is missing the `${projectId}/` prefix", () => {
    it("drops it without leasing (ADR-023 contract)", async () => {
      const dispatcher = vi.fn(async () => undefined);
      drainer.registerDispatcher("alertDispatch", dispatcher);

      await drainer.handleWakeup({
        ...baseWakeup,
        groupKey: "alertDispatch:trigger1",
      });

      expect(repo.leaseNext).not.toHaveBeenCalled();
      expect(dispatcher).not.toHaveBeenCalled();
      expect(scheduleWakeup).not.toHaveBeenCalled();
    });
  });

  describe("when the dispatcher succeeds for every leased row", () => {
    it("marks each row dispatched and stops when the queue is empty", async () => {
      const dispatcher = vi.fn(async () => undefined);
      drainer.registerDispatcher("alertDispatch", dispatcher);
      const rowA = makeRow({ id: "a" });
      const rowB = makeRow({ id: "b" });
      repo.rows = [rowA, rowB];
      repo.leaseNext
        .mockResolvedValueOnce(rowA)
        .mockResolvedValueOnce(rowB)
        .mockResolvedValueOnce(null);

      await drainer.handleWakeup(baseWakeup);

      expect(dispatcher).toHaveBeenCalledTimes(2);
      expect(repo.markDispatched).toHaveBeenCalledTimes(2);
      expect(repo.markDispatched).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({ rowId: "a" }),
      );
      expect(scheduleWakeup).not.toHaveBeenCalled();
    });
  });

  describe("when the dispatcher throws a retryable DispatchError", () => {
    it("schedules a backoff retry and a delayed follow-up wakeup", async () => {
      const dispatcher = vi.fn(async () => {
        throw new DispatchError({
          message: "503 from provider",
          retryable: true,
        });
      });
      drainer.registerDispatcher("alertDispatch", dispatcher);
      const row = makeRow({ attempts: 1 });
      repo.rows = [row];
      repo.leaseNext
        .mockResolvedValueOnce(row)
        .mockResolvedValueOnce(null);

      await drainer.handleWakeup(baseWakeup);

      expect(repo.markRetry).toHaveBeenCalledTimes(1);
      const update = repo.markRetry.mock.calls[0]![0];
      expect(update.status).toBe("failed_retryable");
      expect(update.lastError).toBe("503 from provider");
      expect(scheduleWakeup).toHaveBeenCalledTimes(1);
      expect(scheduleWakeup.mock.calls[0]![0].delayMs).toBeGreaterThanOrEqual(
        0,
      );
    });
  });

  describe("when the dispatcher throws a non-retryable DispatchError", () => {
    it("marks the row dead and does not schedule a follow-up", async () => {
      const dispatcher = vi.fn(async () => {
        throw new DispatchError({
          message: "401 invalid Slack token",
          retryable: false,
        });
      });
      drainer.registerDispatcher("alertDispatch", dispatcher);
      const row = makeRow();
      repo.rows = [row];
      repo.leaseNext
        .mockResolvedValueOnce(row)
        .mockResolvedValueOnce(null);

      await drainer.handleWakeup(baseWakeup);

      expect(repo.markRetry).toHaveBeenCalledWith(
        expect.objectContaining({ status: "dead" }),
      );
      expect(scheduleWakeup).not.toHaveBeenCalled();
    });
  });

  describe("when the dispatcher throws an unclassified error", () => {
    it("treats it as retryable", async () => {
      const dispatcher = vi.fn(async () => {
        throw new Error("ECONNRESET");
      });
      drainer.registerDispatcher("alertDispatch", dispatcher);
      const row = makeRow({ attempts: 1 });
      repo.rows = [row];
      repo.leaseNext
        .mockResolvedValueOnce(row)
        .mockResolvedValueOnce(null);

      await drainer.handleWakeup(baseWakeup);

      expect(repo.markRetry).toHaveBeenCalledWith(
        expect.objectContaining({ status: "failed_retryable" }),
      );
    });
  });

  describe("when maxRowsPerWakeup is reached and rows remain", () => {
    it("schedules an immediate follow-up wakeup to yield", async () => {
      const dispatcher = vi.fn(async () => undefined);
      drainer.registerDispatcher("alertDispatch", dispatcher);
      repo.rows = [makeRow({ id: "a" }), makeRow({ id: "b" }), makeRow({ id: "c" })];
      repo.leaseNext
        .mockResolvedValueOnce(repo.rows[0]!)
        .mockResolvedValueOnce(repo.rows[1]!)
        .mockResolvedValueOnce(repo.rows[2]!);

      await drainer.handleWakeup(baseWakeup);

      expect(dispatcher).toHaveBeenCalledTimes(3);
      expect(scheduleWakeup).toHaveBeenCalledTimes(1);
      expect(scheduleWakeup.mock.calls[0]![0].delayMs).toBeUndefined();
    });
  });

  describe("when a dispatcher is registered twice for the same name", () => {
    it("throws", () => {
      drainer.registerDispatcher("alertDispatch", async () => undefined);
      expect(() =>
        drainer.registerDispatcher("alertDispatch", async () => undefined),
      ).toThrow(/already registered/);
    });
  });
});
