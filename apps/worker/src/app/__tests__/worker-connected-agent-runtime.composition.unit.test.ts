import type { RedisConnection } from "@langwatch/redis-client";
import { ResourceScope } from "@langwatch/runtime-composition";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { installWorkerConnectedAgentRuntime } from "../worker-connected-agent-runtime.composition";

const { install, close } = vi.hoisted(() => ({
  install: vi.fn(),
  close: vi.fn(async () => undefined),
}));

vi.mock("@langwatch/agent-server", () => ({
  ConnectedAgentRuntimeAdapter: { install, close },
}));

/**
 * The experiment feature's connected cell reads `ConnectedAgentRuntimeAdapter.get()`
 * from this process too (ADR-128); without Redis installed here it can never
 * see an instance the API process registered.
 */
describe("installWorkerConnectedAgentRuntime", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("given the Redis this process already holds", () => {
    it("installs it into the connected-agent runtime and closes it on shutdown", async () => {
      const redis = {} as RedisConnection;
      const resources = new ResourceScope();

      installWorkerConnectedAgentRuntime({ redis, resources });

      expect(install).toHaveBeenCalledWith(redis);
      await resources.close();
      expect(close).toHaveBeenCalledTimes(1);
    });
  });

  describe("given a deployment with no Redis", () => {
    it("installs nothing", () => {
      installWorkerConnectedAgentRuntime({ redis: null });

      expect(install).not.toHaveBeenCalled();
    });
  });
});
