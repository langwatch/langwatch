import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ResourceScope } from "@langwatch/runtime-composition";

const mocks = vi.hoisted(() => ({
  configureLogger: vi.fn(),
  shutdown: vi.fn(async () => undefined),
  logger: { info: vi.fn(), error: vi.fn() },
  createObservability: vi.fn(),
}));

vi.mock("@langwatch/observability", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@langwatch/observability")>();
  return {
    ...actual,
    configureLogger: mocks.configureLogger,
  };
});

vi.mock("@langwatch/observability/node", () => ({
  createProcessObservability: mocks.createObservability,
}));

import { bootWorker } from "../worker.process";

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

  it("rejects an invalid Worker-only storage selection before the process graph exists", async () => {
    const createComposition = vi.fn();

    await expect(
      bootWorker({
        source: { STORED_OBJECTS_BACKEND: "gcs" },
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
          drain: vi.fn(async () => {
            phases.push("eventing");
          }),
          closeResources: vi.fn(async () => {
            phases.push("application-resources");
          }),
          close: vi.fn(async () => {
            phases.push("close");
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
    expect(phases).toEqual([
      "start",
      "eventing",
      "observability",
      "application-resources",
      "resources",
    ]);
    expect(mocks.shutdown).toHaveBeenCalledOnce();
    expect(mocks.logger.info).toHaveBeenCalledWith(
      { eventingConsumers: "unstated" },
      "worker composition ready",
    );
  });

  it("logs the consumer ownership the composition declares", async () => {
    const createComposition = vi.fn(async () => ({
      eventingConsumers: "packaged" as const,
      application: {
        start: vi.fn(async () => void 0),
        drain: vi.fn(async () => void 0),
        closeResources: vi.fn(async () => void 0),
        close: vi.fn(async () => void 0),
      },
    }));

    const worker = await bootWorker({ source: { NODE_ENV: "test" }, createComposition });
    await worker.close();

    expect(mocks.logger.info).toHaveBeenCalledWith(
      { eventingConsumers: "packaged" },
      "worker composition ready",
    );
    expect(mocks.logger.info).not.toHaveBeenCalledWith(
      expect.objectContaining({ mode: "producer-only" }),
      expect.anything(),
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
          drain: vi.fn(async () => {
            phases.push("application");
            throw new Error("application drain failed");
          }),
          closeResources: vi.fn(async () => {
            phases.push("application-resources");
          }),
          close: vi.fn(async () => {
            phases.push("close");
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
    expect(phases).toEqual(["application", "observability", "application-resources", "resources"]);
    expect(mocks.shutdown).toHaveBeenCalledOnce();
    await worker.close().catch(() => void 0);
    expect(phases).toEqual(["application", "observability", "application-resources", "resources"]);
  });

  it("flushes telemetry before closing already-created process resources when composition fails", async () => {
    const phases: string[] = [];
    const closeFailure = new Error("composition failed");
    const createComposition = vi.fn(async ({ resources }: { resources: ResourceScope }) => {
      resources.own("partial", () => {
        phases.push("resources");
      });
      throw closeFailure;
    });
    mocks.shutdown.mockImplementation(async () => {
      phases.push("observability");
    });

    await expect(bootWorker({ source: { NODE_ENV: "test" }, createComposition })).rejects.toBe(
      closeFailure,
    );
    expect(mocks.shutdown).toHaveBeenCalledOnce();
    expect(phases).toEqual(["observability", "resources"]);
  });
});
