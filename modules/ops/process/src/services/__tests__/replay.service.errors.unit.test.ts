import { type ReplayHistoryEntry, type ReplayStatus } from "@langwatch/ops-contract";
import { describe, expect, it, vi } from "vitest";

import type { OpsReplayRuntime, OpsReplayRuntimeFactory } from "../../app/ops.app.ts";
import { type ReplayLockHolder, ReplayRepository } from "../../repositories/replay.repository.ts";
import { ReplayService } from "../replay.service.ts";

class ReplayRepositoryStub extends ReplayRepository {
  readonly getStatus = vi.fn<() => Promise<ReplayStatus>>();
  readonly writeStatus = vi.fn<(params: { status: ReplayStatus }) => Promise<void>>();
  readonly acquireLock =
    vi.fn<(params: { runId: string; ttlSeconds: number }) => Promise<boolean>>();
  readonly refreshLock =
    vi.fn<(params: { runId: string; ttlSeconds: number }) => Promise<boolean>>();
  readonly releaseLock = vi.fn<(params: { runId: string }) => Promise<void>>();
  readonly getLockHolder = vi.fn<() => Promise<ReplayLockHolder>>();
  readonly isCancelled = vi.fn<() => Promise<boolean>>();
  readonly setCancelled = vi.fn<(params: { ttlSeconds: number }) => Promise<void>>();
  readonly clearCancelFlag = vi.fn<() => Promise<void>>();
  readonly pushToHistory = vi.fn<(params: { entry: ReplayHistoryEntry }) => Promise<void>>();
  readonly findHistory = vi.fn<() => Promise<ReplayHistoryEntry[]>>();
}

const request = {
  projectionNames: ["trace-summary"],
  since: "2026-01-01T00:00:00.000Z",
  tenantIds: ["tenant_1"],
  description: "repair trace summaries",
  userName: "operator@example.com",
};

const serviceOver = (repo: ReplayRepository): ReplayService => {
  const runtimeFactory: OpsReplayRuntimeFactory = {
    create: vi.fn<() => OpsReplayRuntime>(),
  };

  return ReplayService.create({ repo, runtimeFactory });
};

describe("replay start errors", () => {
  /** @scenario "A concurrent replay start reports the stable conflict" */
  it("reports an already-running replay without changing its status", async () => {
    const repo = new ReplayRepositoryStub();
    repo.acquireLock.mockResolvedValue(false);
    const service = serviceOver(repo);

    await expect(service.startReplay(request)).rejects.toMatchObject({
      code: "replay_already_running",
      message: "A replay is already running",
      httpStatus: 409,
    });

    expect(repo.clearCancelFlag).not.toHaveBeenCalled();
    expect(repo.writeStatus).not.toHaveBeenCalled();
  });

  /** @scenario "A replay start failure keeps its stable operator error" */
  it("reports a safe start error and keeps the storage failure as its cause", async () => {
    const repo = new ReplayRepositoryStub();
    const storageFailure = new Error("redis unavailable");
    repo.acquireLock.mockResolvedValue(true);
    repo.clearCancelFlag.mockRejectedValue(storageFailure);
    const service = serviceOver(repo);

    await expect(service.startReplay(request)).rejects.toMatchObject({
      code: "replay_start_failed",
      message: "Replay could not be started",
      httpStatus: 409,
      cause: storageFailure,
    });

    expect(repo.writeStatus).not.toHaveBeenCalled();
  });

  it("maps lock acquisition failures to the stable start error", async () => {
    const repo = new ReplayRepositoryStub();
    repo.acquireLock.mockRejectedValue(new Error("redis unavailable"));

    await expect(serviceOver(repo).startReplay(request)).rejects.toMatchObject({
      code: "replay_start_failed",
      httpStatus: 409,
    });
  });
});
