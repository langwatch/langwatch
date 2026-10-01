import {
  ReplayService as EventingReplayService,
  type RegisteredFoldProjection,
  type ReplayEventSource,
  sealFoldProjection,
} from "@langwatch/eventing";
import { IDLE_STATUS, type ReplayHistoryEntry, type ReplayStatus } from "@langwatch/ops-contract";
import IORedis from "ioredis";
import { afterAll, describe, expect, it, vi } from "vitest";

import type { OpsReplayRuntime, OpsReplayRuntimeFactory } from "../../app/ops.app.ts";
import type { ProjectionReplayRun } from "../../eventing/ops-projection-replay.events.ts";
import { type ReplayLockHolder, ReplayRepository } from "../../repositories/replay.repository.ts";
import { type ProjectionReplayRequestSender, ReplayService } from "../replay.service.ts";

/** Redis's replay keys in memory: the lock, the status row, the cancel flag and the history. */
class InMemoryReplayRepository extends ReplayRepository {
  lock: ReplayLockHolder = { kind: "free" };
  status: ReplayStatus = { ...IDLE_STATUS };
  cancelled = false;
  history: ReplayHistoryEntry[] = [];

  getStatus = () => Promise.resolve(this.status);
  writeStatus = ({ status }: { status: ReplayStatus }) => {
    this.status = status;
    return Promise.resolve();
  };
  acquireLock = ({ runId }: { runId: string; ttlSeconds: number }) => {
    if (this.lock.kind === "held") return Promise.resolve(false);
    this.lock = { kind: "held", runId };
    return Promise.resolve(true);
  };
  refreshLock = ({ runId }: { runId: string; ttlSeconds: number }) =>
    Promise.resolve(this.lock.kind === "held" && this.lock.runId === runId);
  releaseLock = ({ runId }: { runId: string }) => {
    if (this.lock.kind === "held" && this.lock.runId === runId) this.lock = { kind: "free" };
    return Promise.resolve();
  };
  getLockHolder = () => Promise.resolve(this.lock);
  isCancelled = () => Promise.resolve(this.cancelled);
  setCancelled = () => {
    this.cancelled = true;
    return Promise.resolve();
  };
  clearCancelFlag = () => {
    this.cancelled = false;
    return Promise.resolve();
  };
  pushToHistory = ({ entry }: { entry: ReplayHistoryEntry }) => {
    this.history.unshift(entry);
    return Promise.resolve();
  };
  findHistory = () => Promise.resolve(this.history);
}

const request = {
  projectionNames: ["traceSummary"],
  since: "2026-01-01T00:00:00.000Z",
  tenantIds: ["tenant_1"],
  description: "repair trace summaries",
  userName: "operator@example.com",
  requestedByUserId: "user_operator",
};

// Never connects: the engine's replay is answered below, so no marker is written.
const markers = new IORedis({ lazyConnect: true });
afterAll(() => {
  markers.disconnect();
});

const unreadEventLog: ReplayEventSource = {
  discoverAffectedAggregates: vi.fn(),
  countEventsForAggregates: vi.fn(),
  getBoundedCutoffs: vi.fn(),
  streamEventsForAggregates: vi.fn(),
  loadAggregateEvents: vi.fn(),
};

function foldNamed(projectionName: string): RegisteredFoldProjection {
  return {
    projectionName,
    pipelineName: "trace_processing",
    aggregateType: "trace",
    source: "pipeline",
    pauseKey: `trace_processing/projection/${projectionName}`,
    kind: "fold",
    ...sealFoldProjection({
      name: projectionName,
      version: "2026-09-28",
      eventTypes: [],
      init: () => ({}),
      apply: (state) => state,
      store: { get: vi.fn(), store: vi.fn() },
      LastEventOccurredAtKey: "LastEventOccurredAt",
    }),
  };
}

/** A runtime whose engine answers one finished run over the projections it names. */
function runtimeWith(projectionNames: string[]): OpsReplayRuntime {
  const service = new EventingReplayService({ eventSource: unreadEventLog, redis: markers });
  vi.spyOn(service, "replay").mockResolvedValue({
    aggregatesReplayed: 3,
    totalEvents: 12,
    batchErrors: 0,
  });
  return {
    service,
    projections: projectionNames.map(foldNamed),
    mapProjections: [],
    stateProjections: [],
    close: () => Promise.resolve(),
  };
}

function serviceOver({
  repo,
  create,
}: {
  repo: InMemoryReplayRepository;
  create: () => OpsReplayRuntime;
}): { service: ReplayService; sent: ProjectionReplayRun[]; created: () => number } {
  const factory = vi.fn(create);
  const runtimeFactory: OpsReplayRuntimeFactory = { create: factory };
  const service = ReplayService.create({ repo, runtimeFactory });
  const sent: ProjectionReplayRun[] = [];
  const sender: ProjectionReplayRequestSender = {
    send: (input) => {
      sent.push(input);
      return Promise.resolve();
    },
  };
  service.connect(sender);
  return { service, sent, created: () => factory.mock.calls.length };
}

describe("ReplayService", () => {
  describe("given no replay has ever run", () => {
    /** @scenario "Replay status reads idle when no run exists" */
    it("answers the idle status without building a runtime", async () => {
      const repo = new InMemoryReplayRepository();
      const { service, created } = serviceOver({ repo, create: () => runtimeWith([]) });

      expect((await service.getStatus()).state).toBe("idle");
      expect(created()).toBe(0);
    });
  });

  describe("when an operator starts a replay", () => {
    /** @scenario "Starting a replay records it running and the worker executes it" */
    it("records the run running, hands it to the pipeline, and the worker completes it", async () => {
      const repo = new InMemoryReplayRepository();
      const { service, sent } = serviceOver({
        repo,
        create: () => runtimeWith(["traceSummary"]),
      });

      const { runId } = await service.startReplay(request);

      expect(repo.status).toMatchObject({ state: "running", runId });
      expect(sent).toEqual([
        expect.objectContaining({ runId, tenantId: "user_operator", since: request.since }),
      ]);

      await service.executeReplay(sent[0]!);

      expect(repo.status).toMatchObject({ state: "completed", runId, eventsProcessed: 12 });
      expect(repo.history[0]).toMatchObject({ runId, state: "completed" });
      expect(repo.lock).toEqual({ kind: "free" });
    });
  });

  describe("given a replay is already running", () => {
    /** @scenario "A second start while one runs is refused as already running" */
    it("refuses the second start with replay_already_running and sends nothing", async () => {
      const repo = new InMemoryReplayRepository();
      const { service, sent } = serviceOver({ repo, create: () => runtimeWith([]) });
      await service.startReplay(request);

      await expect(service.startReplay(request)).rejects.toMatchObject({
        code: "replay_already_running",
      });
      expect(sent).toHaveLength(1);
    });
  });

  describe("given the process never connected the replay pipeline", () => {
    /** @scenario "Starting a replay where the pipeline never connected is refused as unavailable" */
    it("refuses the start as unavailable before taking the lock", async () => {
      const repo = new InMemoryReplayRepository();
      const service = ReplayService.create({
        repo,
        runtimeFactory: { create: () => runtimeWith([]) },
      });

      await expect(service.startReplay(request)).rejects.toMatchObject({ httpStatus: 503 });
      expect(repo.lock).toEqual({ kind: "free" });
    });
  });

  describe("when the request cannot be handed to the pipeline", () => {
    it("records the run failed, frees the lock and reports replay_start_failed", async () => {
      const repo = new InMemoryReplayRepository();
      const service = ReplayService.create({
        repo,
        runtimeFactory: { create: () => runtimeWith([]) },
      });
      service.connect({ send: () => Promise.reject(new Error("queue refused")) });

      await expect(service.startReplay(request)).rejects.toMatchObject({
        code: "replay_start_failed",
      });
      expect(repo.status).toMatchObject({ state: "failed", error: "queue refused" });
      expect(repo.lock).toEqual({ kind: "free" });
    });
  });

  describe("given the execute intent is redelivered for a run that no longer holds the lock", () => {
    /** @scenario "A redelivered execute intent for a run that no longer holds the lock does nothing" */
    it("returns without building a runtime or touching the status", async () => {
      const repo = new InMemoryReplayRepository();
      const { service, sent, created } = serviceOver({
        repo,
        create: () => runtimeWith(["traceSummary"]),
      });
      await service.startReplay(request);
      const firstRun = sent[0]!;
      await service.executeReplay(firstRun);
      await service.startReplay(request);
      const statusOfSecond = repo.status;

      await service.executeReplay(firstRun);

      expect(created()).toBe(1);
      expect(repo.status).toBe(statusOfSecond);
    });
  });

  describe("given the operator cancelled the run before its worker started", () => {
    /** @scenario "Cancelling a running replay records it cancelled in history" */
    it("records the run cancelled in status and history, and frees the lock", async () => {
      const repo = new InMemoryReplayRepository();
      const { service, sent } = serviceOver({
        repo,
        create: () => runtimeWith(["traceSummary"]),
      });
      const { runId } = await service.startReplay(request);

      expect(await service.cancelReplay()).toEqual({ cancelled: true });
      await service.executeReplay(sent[0]!);

      expect(repo.status).toMatchObject({ state: "cancelled", runId });
      expect(repo.history[0]).toMatchObject({ runId, state: "cancelled" });
      expect(repo.lock).toEqual({ kind: "free" });
    });
  });

  describe("given the worker cannot build a replay runtime", () => {
    /** @scenario "A worker that cannot build the replay runtime records the run failed with a reason" */
    it("records the run failed with the reason and frees the lock", async () => {
      const repo = new InMemoryReplayRepository();
      const { service, sent } = serviceOver({
        repo,
        create: () => {
          throw new Error("Replay requires a standalone Redis");
        },
      });
      await service.startReplay(request);

      await service.executeReplay(sent[0]!);

      expect(repo.status).toMatchObject({
        state: "failed",
        error: "Replay requires a standalone Redis",
      });
      expect(repo.lock).toEqual({ kind: "free" });
    });
  });

  describe("given no installed pipeline registers the selected projection", () => {
    /** @scenario "A projection that no installed pipeline registers finishes with No matching projections found" */
    it("records the run failed with No matching projections found", async () => {
      const repo = new InMemoryReplayRepository();
      const { service, sent } = serviceOver({ repo, create: () => runtimeWith(["otherFold"]) });
      await service.startReplay(request);

      await service.executeReplay(sent[0]!);

      expect(repo.status).toMatchObject({
        state: "failed",
        error: "No matching projections found",
      });
    });
  });
});
