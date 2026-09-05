/**
 * @see specs/background/worker-graceful-shutdown.feature
 * The drain-versus-connections contract, over the real phase runner: a drain past
 * its budget is still running, so what follows turns on whether we are dying.
 */
import { ShutdownPhaseTimeoutError } from "@langwatch/runtime-composition";
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  configureLogger: vi.fn(),
  shutdown: vi.fn(async () => undefined),
  logger: { info: vi.fn(), error: vi.fn() },
  createObservability: vi.fn(),
}));

vi.mock("@langwatch/observability", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@langwatch/observability")>();
  return { ...actual, configureLogger: mocks.configureLogger };
});

vi.mock("@langwatch/observability/node", () => ({
  createProcessObservability: mocks.createObservability,
  otlpMetricsExportOptionsFrom: () => ({
    endpoint: undefined,
    enabled: false,
    headers: {},
    resourceAttributes: {},
    serviceName: "worker",
    deploymentEnvironment: undefined,
  }),
  startOtlpMetricsExport: () => undefined,
}));

import type { ResourceScope } from "@langwatch/runtime-composition";
import { bootWorker } from "../worker.process";

/** The drain budget the process gives its application, read off the timeout it reports. */
const DRAIN_BUDGET_MS = 60_000;

async function workerWhoseDrainNeverFinishes(closed: string[]) {
  mocks.createObservability.mockReturnValue({
    logger: mocks.logger,
    tracer: {},
    shutdown: mocks.shutdown,
  });
  mocks.shutdown.mockImplementation(async () => {
    closed.push("telemetry");
  });
  return bootWorker({
    source: { NODE_ENV: "test" },
    createComposition: async ({ resources }: { resources: ResourceScope }) => {
      resources.own("prisma", () => {
        closed.push("prisma");
      });
      return {
        application: {
          start: vi.fn(async () => void 0),
          drain: () => new Promise<void>(() => undefined),
          closeResources: vi.fn(async () => {
            closed.push("clickhouse");
          }),
          close: vi.fn(async () => void 0),
        },
      };
    },
  });
}

describe("given a drain that never finishes", () => {
  describe("when the process is terminating", () => {
    /** @scenario "A hung drain cannot hold the process open forever" */
    it("stops waiting without severing the still-running drain", async () => {
      vi.useFakeTimers();
      try {
        const closed: string[] = [];
        const worker = await workerWhoseDrainNeverFinishes(closed);

        const closing = worker.close({ terminating: true });
        await vi.advanceTimersByTimeAsync(DRAIN_BUDGET_MS);
        await expect(closing).resolves.toBeUndefined();

        expect(closed).toEqual([]);
        expect(mocks.logger.error).toHaveBeenCalledWith(
          expect.objectContaining({ error: expect.any(ShutdownPhaseTimeoutError) }),
          "shutdown phase failed",
        );
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe("when the process is staying up, as when a host reuses it", () => {
    /** @scenario "A hung drain in a process that is not terminating still releases its handles" */
    it("closes the connections anyway", async () => {
      vi.useFakeTimers();
      try {
        const closed: string[] = [];
        const worker = await workerWhoseDrainNeverFinishes(closed);

        // The expectation is attached BEFORE time is advanced: the rejection
        // lands during the advance, and a promise with no handler at that
        // moment is reported as an unhandled rejection.
        const closed_ = expect(worker.close()).rejects.toBeInstanceOf(ShutdownPhaseTimeoutError);
        await vi.advanceTimersByTimeAsync(DRAIN_BUDGET_MS);
        await closed_;

        expect(closed).toEqual(["telemetry", "clickhouse", "prisma"]);
      } finally {
        vi.useRealTimers();
      }
    });
  });
});
