import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ResourceScope } from "@langwatch/runtime-composition";

const mocks = vi.hoisted(() => ({
  configureLogger: vi.fn(),
  shutdown: vi.fn(async () => undefined),
  logger: { info: vi.fn(), error: vi.fn() },
  createObservability: vi.fn(),
}));

vi.mock("@langwatch/observability", () => ({
  configureLogger: mocks.configureLogger,
}));

vi.mock("@langwatch/observability/node", () => ({
  createProcessObservability: mocks.createObservability,
}));

import { bootWorker } from "../src/worker.process";

describe("bootWorker", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.shutdown.mockResolvedValue(undefined);
    mocks.createObservability.mockReturnValue({
      logger: mocks.logger,
      tracer: {},
      shutdown: mocks.shutdown,
    });
  });

  it("rejects invalid configuration before observability, resources, or composition", async () => {
    const createComposition = vi.fn();

    await expect(
      bootWorker({
        source: { NODE_ENV: "invalid" },
        createComposition,
      }),
    ).rejects.toThrow("Invalid worker configuration");

    expect(createComposition).not.toHaveBeenCalled();
    expect(mocks.createObservability).not.toHaveBeenCalled();
    expect(mocks.configureLogger).not.toHaveBeenCalled();
  });

  it("creates one graph and drains Eventing, resources, then observability", async () => {
    const phases: string[] = [];
    const createComposition = vi.fn(async ({ resources }: { resources: ResourceScope }) => {
      resources.own("database", () => {
        phases.push("resources");
      });
      return {
        application: {
          start: vi.fn(async () => {
            phases.push("start");
          }),
          close: vi.fn(async () => {
            phases.push("eventing");
          }),
        },
      };
    });
    mocks.shutdown.mockImplementation(async () => {
      phases.push("observability");
    });

    const worker = await bootWorker({ source: { NODE_ENV: "test" }, createComposition });
    await worker.start();
    await Promise.all([worker.close(), worker.close()]);

    expect(createComposition).toHaveBeenCalledOnce();
    expect(phases).toEqual(["start", "eventing", "resources", "observability"]);
    expect(mocks.shutdown).toHaveBeenCalledOnce();
    expect(mocks.logger.info).toHaveBeenCalledWith(
      { consumersEnabled: false, mode: "producer-only" },
      "worker Eventing consumer is disabled until the complete registry is mounted",
    );
  });

  it("cleans up a failed start while preserving the original start error", async () => {
    const phases: string[] = [];
    const startFailure = new Error("queue start failed");
    const createComposition = vi.fn(async ({ resources }: { resources: ResourceScope }) => {
      resources.own("database", () => {
        phases.push("resources");
        throw new Error("resource close failed");
      });
      return {
        application: {
          start: vi.fn(async () => {
            throw startFailure;
          }),
          close: vi.fn(async () => {
            phases.push("application");
            throw new Error("application close failed");
          }),
        },
      };
    });
    mocks.shutdown.mockImplementation(async () => {
      phases.push("observability");
      throw new Error("observability close failed");
    });

    const worker = await bootWorker({ source: { NODE_ENV: "test" }, createComposition });

    await expect(worker.start()).rejects.toBe(startFailure);
    expect(phases).toEqual(["application", "resources", "observability"]);
    expect(mocks.shutdown).toHaveBeenCalledOnce();
    await worker.close().catch(() => void 0);
    expect(phases).toEqual(["application", "resources", "observability"]);
  });

  it("closes already-created process resources when composition fails", async () => {
    const closeFailure = new Error("composition failed");
    const createComposition = vi.fn(async ({ resources }: { resources: ResourceScope }) => {
      resources.own("partial", () => undefined);
      throw closeFailure;
    });

    await expect(bootWorker({ source: { NODE_ENV: "test" }, createComposition })).rejects.toBe(
      closeFailure,
    );
    expect(mocks.shutdown).toHaveBeenCalledOnce();
  });
});
