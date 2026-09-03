import type { RedisConnection } from "@langwatch/redis-client";
import { ResourceScope } from "@langwatch/runtime-composition";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { installWorkerConnectedAgentRuntime } from "../worker-connected-agent-runtime.composition";

const { installConnectedAgentRedis, closeConnectedAgentRuntime } = vi.hoisted(() => ({
  installConnectedAgentRedis: vi.fn(),
  closeConnectedAgentRuntime: vi.fn(async () => undefined),
}));

vi.mock("@langwatch/agent-server", () => ({
  installConnectedAgentRedis,
  closeConnectedAgentRuntime,
}));

/**
 * The experiment feature's connected cell reads `getConnectedAgentRuntime()`
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

      expect(installConnectedAgentRedis).toHaveBeenCalledWith(redis);
      await resources.close();
      expect(closeConnectedAgentRuntime).toHaveBeenCalledTimes(1);
    });
  });

  describe("given a deployment with no Redis", () => {
    it("installs nothing", () => {
      installWorkerConnectedAgentRuntime({ redis: null });

      expect(installConnectedAgentRedis).not.toHaveBeenCalled();
    });
  });
});
