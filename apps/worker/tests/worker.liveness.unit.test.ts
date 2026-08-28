import { describe, expect, it } from "vitest";
import {
  WORKER_LIVENESS_PATH,
  createWorkerLivenessPolicy,
  isWorkerHeartbeatLive,
} from "../src/platform/liveness/worker.liveness";

describe("worker liveness policy", () => {
  it("uses the stable worker health endpoint", () => {
    expect(WORKER_LIVENESS_PATH).toBe("/healthz");
  });

  it("is live at the heartbeat stall boundary", () => {
    const policy = createWorkerLivenessPolicy({ stallBudgetMs: 5_000 });

    expect(isWorkerHeartbeatLive({ observedAtMs: 10_000, nowMs: 15_000, policy })).toBe(true);
  });

  it("is unavailable after the heartbeat stall budget", () => {
    const policy = createWorkerLivenessPolicy({ stallBudgetMs: 5_000 });

    expect(isWorkerHeartbeatLive({ observedAtMs: 10_000, nowMs: 15_001, policy })).toBe(false);
  });

  it("rejects a negative liveness stall budget", () => {
    expect(() => createWorkerLivenessPolicy({ stallBudgetMs: -1 })).toThrow();
  });
});
