import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { EventBus } from "../../src/services/event-bus.ts";
import { startLangwatch } from "../../src/services/langwatch.ts";
import type { RuntimeContext, RuntimeEvent } from "../../src/shared/runtime-contract.ts";

const { stop, supervise, probe, probedUrls } = vi.hoisted(() => {
  const stop = vi.fn(async () => {});
  return {
    stop,
    supervise: vi.fn(
      (_args: { spec: { args: string[]; cwd?: string; env: Record<string, string> } }) => ({
        name: "langwatch",
        pid: 1,
        stop,
      }),
    ),
    probe: { ok: true },
    probedUrls: new Array<string>(),
  };
});

// A real directory with its node_modules, so the launcher skips the one-time install.
let backendDir = "";

vi.mock("../../src/services/spawn.ts", () => ({ supervise }));
vi.mock("../../src/services/node-deps.ts", () => ({
  locateBackendDir: () => backendDir,
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
      workerHealth: 5565,
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

function spawned() {
  return supervise.mock.calls[0]![0].spec;
}

describe("startLangwatch", () => {
  beforeEach(() => {
    backendDir = mkdtempSync(join(tmpdir(), "lw-backend-"));
    mkdirSync(join(backendDir, "node_modules"));
    probe.ok = true;
    probedUrls.length = 0;
    stop.mockClear();
    supervise.mockClear();
  });

  afterEach(() => {
    rmSync(backendDir, { recursive: true, force: true });
  });

  describe("when the launcher starts the backend", () => {
    /** @scenario "The backend runs the api and the worker as one process" */
    it("runs apps/backend's start script, the api and the worker in one process", async () => {
      await startLangwatch(fakeCtx(), new EventBus(), {});

      expect(supervise).toHaveBeenCalledTimes(1);
      expect(spawned().cwd).toBe(backendDir);
      expect(spawned().args).toEqual(["run", "start"]);
    });

    /** @scenario "The backend runs the api and the worker as one process" */
    it("binds the api to the langwatch port and the worker's health door to its own slot", async () => {
      await startLangwatch(fakeCtx(), new EventBus(), { WORKER_METRICS_PORT: "2999" });

      expect(spawned().env).toMatchObject({
        API_PORT: "5560",
        PORT: "5560",
        WORKER_METRICS_PORT: "5565",
      });
    });

    /** @scenario "The backend leaves migrations to the worker's upgrade" */
    it("leaves the worker's upgrade to run its migrations", async () => {
      await startLangwatch(fakeCtx(), new EventBus(), {});

      expect(spawned().env.SKIP_PRISMA_MIGRATE).toBeUndefined();
      expect(spawned().env.SKIP_CLICKHOUSE_MIGRATE).toBeUndefined();
    });
  });

  describe("when the api's health route answers", () => {
    /** @scenario "The backend runs the api and the worker as one process" */
    it("waits on that one door and reports the backend healthy", async () => {
      const bus = new EventBus();
      const events = collect(bus);

      await startLangwatch(fakeCtx(), bus, {});

      expect(probedUrls).toEqual(["http://127.0.0.1:5560/api/health"]);
      expect(events.map((e) => e.type)).toEqual(["starting", "healthy"]);
    });
  });

  describe("when the api's health route never answers", () => {
    /** @scenario "The backend runs the api and the worker as one process" */
    it("stops the backend and refuses to report it healthy", async () => {
      probe.ok = false;
      const bus = new EventBus();
      const events = collect(bus);

      await expect(startLangwatch(fakeCtx(), bus, {})).rejects.toThrow(
        "langwatch did not become healthy",
      );
      expect(stop).toHaveBeenCalledTimes(1);
      expect(events.map((e) => e.type)).toEqual(["starting"]);
    });
  });
});
