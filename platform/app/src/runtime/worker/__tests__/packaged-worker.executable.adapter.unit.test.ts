/**
 * The executable composition that makes the packaged graph the process's one
 * consumer.
 *
 * It is the only caller allowed to ask an App for `eventingConsumers:
 * "external"`, and the only one allowed to turn the packaged consumer on. Both
 * halves of that are asserted here, because the failure they prevent is
 * invisible: a worker with no consumer, or two, looks healthy from every angle
 * the fleet watches.
 *
 * The App is mocked rather than booted — `initializeDefaultApp` builds a
 * ClickHouse runtime singleton, a scheduler and a Redis connection, none of
 * which a unit test may hold.
 */
import { ResourceScope } from "@langwatch/runtime-composition";
import {
  resolveWorkerConfig,
  WorkerProductionComposition,
  type WorkerApplicationPort,
  type WorkerProcessFactoryContext,
} from "@langwatch/worker";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PackagedWorkerExecutableComposition } from "~/runtime/worker/packaged-worker.executable.adapter";
import type { App } from "~/server/app-layer/app";
import type { WorkerEventingHandoff } from "~/server/app-layer/worker-eventing-handoff";

const initializeWorkerApp = vi.fn();
const createLegacyWorkerPorts = vi.fn();
const isClickHouseEnabled = vi.fn(() => true);

vi.mock("~/server/app-layer/presets", () => ({
  initializeWorkerApp: (options?: unknown) => initializeWorkerApp(options) as App,
}));
vi.mock("~/server/clickhouse/clickhouseClient", () => ({
  isClickHouseEnabled: () => isClickHouseEnabled(),
}));
vi.mock("../legacy-worker.adapter", () => ({
  createLegacyWorkerPorts: (app: App) => createLegacyWorkerPorts(app) as unknown,
}));

function handoff(overrides?: Partial<WorkerEventingHandoff>): WorkerEventingHandoff {
  return {
    appOwnsEventingConsumers: false,
    isSaas: false,
    capabilities: {
      definition: () => ({}),
      trace: { pipeline: {} },
      eventingMaintenance: { blobSweep: {}, retentionMetrics: {} },
      governanceRuntime: {},
    } as never,
    substrate: {
      prisma: {} as never,
      resolveClickHouseClient: (async () => ({})) as never,
      groupQueue: { redis: {} } as never,
      persistenceRetention: {} as never,
      retentionPolicyResolver: {} as never,
      replayMarkerChecker: { name: "replay" } as never,
    },
    topic: {} as never,
    ...overrides,
  };
}

function packagedApplication() {
  const calls: string[] = [];
  const application: WorkerApplicationPort = {
    start: async () => void calls.push("start"),
    drain: async () => void calls.push("drain"),
    closeResources: async () => void calls.push("closeResources"),
    close: async () => void calls.push("close"),
  };
  return { calls, composition: { application } as WorkerProductionComposition };
}

function factoryContext(): WorkerProcessFactoryContext {
  return {
    config: resolveWorkerConfig({ NODE_ENV: "test" }),
    resources: new ResourceScope(),
    observability: { logger: { info: () => void 0 } } as never,
  };
}

const compose = () =>
  PackagedWorkerExecutableComposition.create({ source: { NODE_ENV: "test" } }).compose(
    factoryContext(),
  );

describe("PackagedWorkerExecutableComposition", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    isClickHouseEnabled.mockReturnValue(true);
    createLegacyWorkerPorts.mockImplementation(() => ({
      lifecycle: { close: async () => void 0 },
      transport: { start: async () => ({ shutdown: async () => void 0 }) },
    }));
  });

  describe("given a worker process the packaged graph will consume for", () => {
    /**
     * The App becomes byte-for-byte the web-role App that has produced without
     * consuming for months. Asking for it is what makes the single-consumer
     * invariant structural rather than a convention two compositions honour.
     */
    it("boots the App as a producer and takes the consumers itself", async () => {
      initializeWorkerApp.mockReturnValue({ workerEventingHandoff: handoff() });
      const create = vi
        .spyOn(WorkerProductionComposition, "create")
        .mockReturnValue(packagedApplication().composition);

      await compose();

      expect(initializeWorkerApp).toHaveBeenCalledWith({ eventingConsumers: "external" });
      expect(create.mock.calls[0]?.[0]?.eventing.consumers).toEqual({
        enabled: true,
        replayMarkerChecker: { name: "replay" },
      });
    });

    /** `startWorkers()`'s non-Eventing loops keep the ports they always had. */
    it("drives the transport through the App's own worker ports", async () => {
      const app = { workerEventingHandoff: handoff() };
      const ports = {
        lifecycle: { close: async () => void 0 },
        transport: { start: async () => ({ shutdown: async () => void 0 }) },
      };
      initializeWorkerApp.mockReturnValue(app);
      createLegacyWorkerPorts.mockReturnValue(ports);
      const create = vi
        .spyOn(WorkerProductionComposition, "create")
        .mockReturnValue(packagedApplication().composition);

      await compose();

      expect(createLegacyWorkerPorts).toHaveBeenCalledWith(app);
      expect(create.mock.calls[0]?.[0]?.lifecycle).toBe(ports.lifecycle);
      expect(create.mock.calls[0]?.[0]?.transport).toBe(ports.transport);
    });
  });

  describe("given an App that claimed the consumers itself", () => {
    it("fails the boot rather than composing a second consumer", async () => {
      initializeWorkerApp.mockReturnValue({
        workerEventingHandoff: handoff({ appOwnsEventingConsumers: true }),
      });
      const create = vi.spyOn(WorkerProductionComposition, "create");

      await expect(compose()).rejects.toThrow("the App claimed the consumers itself");
      expect(create).not.toHaveBeenCalled();
    });
  });

  describe("given a composed packaged application", () => {
    /**
     * Composing is not starting. The process root owns when 26 pipelines mount
     * and the consumer goes live, so a failure arrives through the lifecycle
     * that can drain what has already been staged.
     */
    it("leaves the ordered start to the process root", async () => {
      const packaged = packagedApplication();
      initializeWorkerApp.mockReturnValue({ workerEventingHandoff: handoff() });
      vi.spyOn(WorkerProductionComposition, "create").mockReturnValue(packaged.composition);

      const composition = await compose();
      expect(packaged.calls).toEqual([]);

      await composition.application.start();
      expect(packaged.calls).toEqual(["start"]);
    });

    /**
     * Drain first, release second. The consumer stops and the feature handles
     * close while Prisma, ClickHouse and Redis are still live; only then does
     * the App's boot scope close the App underneath them.
     */
    it("drains the packaged graph before releasing the App", async () => {
      const packaged = packagedApplication();
      initializeWorkerApp.mockReturnValue({ workerEventingHandoff: handoff() });
      vi.spyOn(WorkerProductionComposition, "create").mockReturnValue(packaged.composition);

      const composition = await compose();
      await composition.application.close();

      expect(packaged.calls).toEqual(["drain", "close"]);
    });
  });
});
