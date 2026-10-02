import { beforeEach, describe, expect, it, vi } from "vitest";

import { EventBus } from "../../src/services/event-bus.ts";
import { startLangwatchWorkers } from "../../src/services/langwatch-workers.ts";
import type { RuntimeContext, RuntimeEvent } from "../../src/shared/runtime-contract.ts";

const { stop, supervise, probe, probedUrls } = vi.hoisted(() => {
  const stop = vi.fn(async () => {});
  return {
    stop,
    supervise: vi.fn((_args: { spec: { env: Record<string, string> } }) => ({
      name: "workers",
      pid: 1,
      stop,
    })),
    probe: { ok: true },
    probedUrls: new Array<string>(),
  };
});

vi.mock("../../src/services/spawn.ts", () => ({ supervise }));
vi.mock("../../src/services/node-deps.ts", () => ({
  locateWorkerDir: () => "/fake/apps/worker",
  resolvePnpm: async () => ({ command: "pnpm", args: [] }),
}));
vi.mock("../../src/services/health.ts", () => ({
  httpGetCheck: (url: string) => {
    probedUrls.push(url);
    return async () => ({ ok: true, durationMs: 0 });
  },
  pollUntilHealthy: async () =>
    probe.ok ? { ok: true, durationMs: 1 } : { ok: false, durationMs: 1, reason: "timed out" },
}));

function fakeCtx(): RuntimeContext {
  return {
    ports: {
      base: 5560,
      langwatch: 5560,
      nlp: 5561,
      langevals: 5562,
      aigateway: 5563,
      langyagent: 5564,
      postgres: 6560,
      redis: 6561,
      clickhouseHttp: 6562,
      clickhouseNative: 6563,
    },
    paths: {
      root: "/tmp/.langwatch-test",
      bin: "/tmp/.langwatch-test/bin",
      app: "/tmp/.langwatch-test/app",
      data: "/tmp/.langwatch-test/data",
      redisData: "/tmp/.langwatch-test/data/redis",
      postgresData: "/tmp/.langwatch-test/data/postgres",
      clickhouseData: "/tmp/.langwatch-test/data/clickhouse",
      logs: "/tmp/.langwatch-test/logs",
      pidFile: "/tmp/.langwatch-test/run/langwatch.pid",
      lockFile: "/tmp/.langwatch-test/run/langwatch.lock",
      envFile: "/tmp/.langwatch-test/.env",
      installManifest: "/tmp/.langwatch-test/install-manifest.json",
    },
    predeps: {},
    envFile: "/tmp/.langwatch-test/.env",
    version: "test",
    userEnv: {},
    orchestrator: {
      browser: { openEnabled: true, continuousIntegration: false },
      development: { aiGatewayDevBuild: false, forceBundledPostgres: false },
    },
  };
}

function collect(bus: EventBus): RuntimeEvent[] {
  const events: RuntimeEvent[] = [];
  const emit = bus.emit.bind(bus);
  bus.emit = (event) => {
    events.push(event);
    emit(event);
  };
  return events;
}

describe("startLangwatchWorkers", () => {
  beforeEach(() => {
    probe.ok = true;
    probedUrls.length = 0;
    stop.mockClear();
    supervise.mockClear();
  });

  describe("when the launcher starts the worker", () => {
    it("tells it the launcher already migrated and the api already provisioned", async () => {
      await startLangwatchWorkers(fakeCtx(), new EventBus(), {});
      expect(supervise.mock.calls[0]![0].spec.env).toMatchObject({
        SKIP_PRISMA_MIGRATE: "true",
        SKIP_CLICKHOUSE_MIGRATE: "true",
        SKIP_LWQL_PROVISION: "true",
      });
    });

    it("probes the health door on the port the worker binds", async () => {
      await startLangwatchWorkers(fakeCtx(), new EventBus(), { WORKER_METRICS_PORT: "3999" });
      expect(supervise.mock.calls[0]![0].spec.env.WORKER_METRICS_PORT).toBe("3999");
      expect(probedUrls).toEqual(["http://127.0.0.1:3999/healthz"]);
    });
  });

  describe("when the health door answers", () => {
    it("reports the worker healthy", async () => {
      const bus = new EventBus();
      const events = collect(bus);
      await startLangwatchWorkers(fakeCtx(), bus, {});
      expect(events.map((e) => e.type)).toEqual(["starting", "healthy"]);
    });
  });

  describe("when the health door never answers", () => {
    it("stops the worker and refuses to report it healthy", async () => {
      probe.ok = false;
      const bus = new EventBus();
      const events = collect(bus);
      await expect(startLangwatchWorkers(fakeCtx(), bus, {})).rejects.toThrow(
        "workers did not become healthy",
      );
      expect(stop).toHaveBeenCalledTimes(1);
      expect(events.map((e) => e.type)).toEqual(["starting"]);
    });
  });
});
