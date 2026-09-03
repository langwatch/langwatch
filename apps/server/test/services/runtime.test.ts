import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupervisedHandle } from "../../src/services/spawn.ts";
import type { RuntimeContext, RuntimeEvent } from "../../src/shared/runtime-contract.ts";

// Track call order across all mocked service modules. Each fn pushes its own
// label on entry so we can assert phase ordering without coupling to timing.
const callLog: string[] = [];

function makeStub(name: string, durationMs = 1) {
  return {
    fn: vi.fn(async (_ctx: RuntimeContext, bus: { emit(e: RuntimeEvent): void }) => {
      callLog.push(`start:${name}`);
      bus.emit({ type: "starting", service: name });
      bus.emit({ type: "healthy", service: name, durationMs });
      const handle: SupervisedHandle = {
        name,
        pid: callLog.length,
        // The runtime never reads .child, only .stop().
        child: null as never,
        stop: vi.fn(async () => {
          callLog.push(`stop:${name}`);
        }),
      };
      return handle;
    }),
  };
}

const postgresStub = makeStub("postgres");
const redisStub = makeStub("redis");
const clickhouseStub = makeStub("clickhouse");
const nlpStub = makeStub("nlpgo");
const langevalsStub = makeStub("langevals");
const gatewayStub = makeStub("aigateway");
const langwatchStub = makeStub("langwatch");
const langyStub = makeStub("langyagent");

const migrateFn = vi.fn(async () => {
  callLog.push("migrate");
});
const venvsFn = vi.fn(async () => {
  callLog.push("venvs");
});
const nodeDepsFn = vi.fn(async () => {
  callLog.push("node-deps");
});
const ensureAppDirFn = vi.fn(async () => {
  callLog.push("app-dir");
});
const langyCliFn = vi.fn(async () => {
  callLog.push("langy-cli");
});

vi.mock("../../src/services/postgres.ts", () => ({
  startPostgres: postgresStub.fn,
}));
vi.mock("../../src/services/redis.ts", () => ({ startRedis: redisStub.fn }));
vi.mock("../../src/services/clickhouse.ts", () => ({
  startClickhouse: clickhouseStub.fn,
}));
vi.mock("../../src/services/nlpgo.ts", () => ({ startNlpgo: nlpStub.fn }));
vi.mock("../../src/services/langevals.ts", () => ({
  startLangevals: langevalsStub.fn,
}));
vi.mock("../../src/services/aigateway.ts", () => ({
  startAigateway: gatewayStub.fn,
}));
vi.mock("../../src/services/langwatch.ts", () => ({
  startLangwatch: langwatchStub.fn,
}));
let langyBinarySupported = true;
vi.mock("../../src/services/langyagent.ts", () => ({
  startLangyagent: langyStub.fn,
  monobinarySupportsLangyagent: vi.fn(async () => langyBinarySupported),
}));
vi.mock("../../src/services/langy-cli.ts", () => ({
  ensureLangyCli: langyCliFn,
}));
vi.mock("../../src/services/langwatch-workers.ts", () => ({
  startLangwatchWorkers: () => ({
    name: "workers",
    pid: 0,
    stop: async () => {
      callLog.push("stop:workers");
    },
  }),
}));
vi.mock("../../src/services/migrate.ts", () => ({ runMigrations: migrateFn }));
vi.mock("../../src/services/venvs.ts", () => ({ syncVenvs: venvsFn }));
vi.mock("../../src/services/node-deps.ts", () => ({
  ensureLangwatchDeps: nodeDepsFn,
  locateLangwatchDir: () => "/tmp/.langwatch-test/app/langwatch",
}));
vi.mock("../../src/services/app-dir.ts", () => ({
  ensureAppDir: ensureAppDirFn,
  appRoot: () => "/tmp/.langwatch-test/app",
}));
let envFileContent: Record<string, string> = {};
vi.mock("../../src/services/env-file.ts", () => ({
  readEnvFile: () => envFileContent,
}));

// Import AFTER vi.mock so the runtime resolves the stubs.
const { runtime } = await import("../../src/services/runtime.ts");

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
    predeps: {
      aigateway: {
        version: "test",
        resolvedPath: "/fake/bin/aigateway",
        preInstalled: false,
      },
    },
    envFile: "/tmp/.langwatch-test/.env",
    version: "test",
    userEnv: {},
    orchestrator: {
      browser: { openEnabled: true, continuousIntegration: false },
      development: { aiGatewayDevBuild: false, forceBundledPostgres: false },
    },
  };
}

describe("services/runtime", () => {
  beforeEach(() => {
    langyBinarySupported = true;
    callLog.length = 0;
    [
      postgresStub.fn,
      redisStub.fn,
      clickhouseStub.fn,
      nlpStub.fn,
      langevalsStub.fn,
      gatewayStub.fn,
      langwatchStub.fn,
      migrateFn,
      venvsFn,
      nodeDepsFn,
      ensureAppDirFn,
      langyCliFn,
    ].forEach((fn) => fn.mockClear());
  });

  describe("when installServices is called", () => {
    it("runs uv venv sync and langwatch node-deps in parallel", async () => {
      await runtime.installServices(fakeCtx());
      expect(venvsFn).toHaveBeenCalledTimes(1);
      expect(nodeDepsFn).toHaveBeenCalledTimes(1);
      expect(callLog).toContain("venvs");
      expect(callLog).toContain("node-deps");
    });

    it("relocates the @langwatch/server tree before venv/node-deps run", async () => {
      // Order matters: venvs + node-deps both resolve paths via appRoot(),
      // which only points at LANGWATCH_HOME/app once ensureAppDir has run.
      await runtime.installServices(fakeCtx());
      expect(ensureAppDirFn).toHaveBeenCalledTimes(1);
      const appDirIdx = callLog.indexOf("app-dir");
      const venvsIdx = callLog.indexOf("venvs");
      const nodeDepsIdx = callLog.indexOf("node-deps");
      expect(appDirIdx).toBeGreaterThanOrEqual(0);
      expect(appDirIdx).toBeLessThan(venvsIdx);
      expect(appDirIdx).toBeLessThan(nodeDepsIdx);
    });
  });

  describe("when startAll is called", () => {
    it("starts infra (pg+redis+clickhouse) → migrates → starts app tier (nlp+langevals+gateway+langwatch+langyagent+workers)", async () => {
      const ctx = fakeCtx();
      const handles = await runtime.startAll(ctx);
      expect(handles).toHaveLength(9);
      const positions: Record<string, number> = {};
      callLog.forEach((entry, idx) => {
        if (!(entry in positions)) positions[entry] = idx;
      });
      // Infra phase 1.
      const infraEnd = Math.max(
        positions["start:postgres"]!,
        positions["start:redis"]!,
        positions["start:clickhouse"]!,
      );
      // Migrations strictly after infra healthy.
      expect(positions["migrate"]).toBeGreaterThan(infraEnd);
      // App tier strictly after migrations.
      expect(positions["start:nlpgo"]).toBeGreaterThan(positions["migrate"]!);
      expect(positions["start:langevals"]).toBeGreaterThan(positions["migrate"]!);
      expect(positions["start:aigateway"]).toBeGreaterThan(positions["migrate"]!);
      expect(positions["start:langwatch"]).toBeGreaterThan(positions["migrate"]!);
    });

    it("starts the assistant alongside the rest of the app tier", async () => {
      await runtime.startAll(fakeCtx());
      expect(callLog).toContain("start:langyagent");
    });

    it("returns ServiceHandle objects with name + pid + stop()", async () => {
      const handles = await runtime.startAll(fakeCtx());
      for (const h of handles) {
        expect(typeof h.name).toBe("string");
        expect(typeof h.pid).toBe("number");
        expect(typeof h.stop).toBe("function");
      }
    });
  });

  describe("when one app-tier service never becomes healthy", () => {
    it("stops the siblings that did start instead of leaking them", async () => {
      // Promise.all rejects on the first failure and DISCARDS the resolved
      // handles, so the started siblings never reached stopHandles: every
      // partial boot leaked live processes that squatted the port slot and
      // forced the next run to auto-shift.
      langwatchStub.fn.mockImplementationOnce(async () => {
        callLog.push("start:langwatch");
        throw new Error("langwatch did not become healthy: timed out");
      });

      await expect(runtime.startAll(fakeCtx())).rejects.toThrow("did not become healthy");

      for (const sibling of ["nlpgo", "langevals", "aigateway"]) {
        expect(callLog).toContain(`stop:${sibling}`);
      }
      // Infra + the assistant come down with them.
      for (const infra of ["postgres", "redis", "clickhouse", "langyagent"]) {
        expect(callLog).toContain(`stop:${infra}`);
      }
    });
  });

  describe("when the assistant is turned off", () => {
    it("does not start it, and does not fetch what only it needs", async () => {
      process.env.LANGWATCH_ENABLE_LANGY = "false";
      try {
        await runtime.installServices(fakeCtx());
        const handles = await runtime.startAll(fakeCtx());
        expect(callLog).not.toContain("start:langyagent");
        expect(callLog).not.toContain("langy-cli");
        // Everything else is untouched.
        expect(handles).toHaveLength(8);
        expect(callLog).toContain("start:langwatch");
        expect(callLog).toContain("venvs");
      } finally {
        delete process.env.LANGWATCH_ENABLE_LANGY;
      }
    });

    it("strips the assistant out of the app's env so nothing points at a service that is not there", async () => {
      process.env.LANGWATCH_ENABLE_LANGY = "false";
      // Simulate a .env scaffolded while the assistant was on: the file keeps
      // its lines (they are the user's knobs), the processes must not see them.
      envFileContent = {
        OPENCODE_AGENT_URL: "http://localhost:5564",
        FEATURE_FLAG_FORCE_ENABLE: "release_langy_enabled,other_flag",
      };
      try {
        await runtime.startAll(fakeCtx());
        const childEnv = langwatchStub.fn.mock.calls.at(-1)![2] as Record<string, string>;
        expect(childEnv.OPENCODE_AGENT_URL).toBeUndefined();
        expect(childEnv.FEATURE_FLAG_FORCE_ENABLE).toBe("other_flag");
        expect(childEnv.LANGWATCH_ENABLE_LANGY).toBe("false");
      } finally {
        envFileContent = {};
        delete process.env.LANGWATCH_ENABLE_LANGY;
      }
    });
  });

  describe("when the release binary predates the assistant", () => {
    it("comes up without it, and says so", async () => {
      langyBinarySupported = false;
      const events: unknown[] = [];
      const ctx = fakeCtx();
      const bus = runtime.events(ctx) as { emit(e: unknown): void };
      const origEmit = bus.emit.bind(bus);
      bus.emit = (e: unknown) => {
        events.push(e);
        origEmit(e);
      };
      const handles = await runtime.startAll(ctx);
      // The whole install still boots; only the assistant is absent.
      expect(callLog).not.toContain("start:langyagent");
      expect(callLog).toContain("start:langwatch");
      expect(handles).toHaveLength(8);
      // The app is told the assistant is off, not left pointing at a corpse.
      const childEnv = langwatchStub.fn.mock.calls.at(-1)![2] as Record<string, string>;
      expect(childEnv.LANGWATCH_ENABLE_LANGY).toBe("false");
      expect(childEnv.OPENCODE_AGENT_URL).toBeUndefined();
      // And the person running the install is told why.
      const warning = events.find(
        (e) =>
          (e as { type?: string; line?: string }).type === "log" &&
          ((e as { line?: string }).line ?? "").includes("langy assistant disabled"),
      );
      expect(warning).toBeDefined();
    });
  });

  describe("when nothing is toggled", () => {
    it("tells the app exactly which evaluators this install skipped", async () => {
      await runtime.startAll(fakeCtx());
      const childEnv = langwatchStub.fn.mock.calls.at(-1)![2] as Record<string, string>;
      // Explicit values, so an install whose .env predates a toggle still
      // gets the truth rather than the app's assume-available default.
      expect(childEnv.LANGWATCH_ENABLE_PRESIDIO).toBe("false");
      expect(childEnv.LANGWATCH_ENABLE_LINGUA).toBe("false");
    });
  });

  describe("when stopAll is called", () => {
    it("stops handles in reverse start order", async () => {
      const handles = await runtime.startAll(fakeCtx());
      callLog.length = 0; // reset to count only stops
      await runtime.stopAll(handles);
      const stopOrder = callLog.filter((entry) => entry.startsWith("stop:"));
      expect(stopOrder).toHaveLength(9);
      // First stopped should be langwatch (last started); last stopped should be one of the infra.
      const firstStopped = stopOrder[0]!.replace("stop:", "");
      const lastStopped = stopOrder[stopOrder.length - 1]!.replace("stop:", "");
      expect(firstStopped).toBe("workers");
      expect(["postgres", "redis", "clickhouse"]).toContain(lastStopped);
    });

    it("does not throw when individual stop() throws", async () => {
      const handles = await runtime.startAll(fakeCtx());
      handles[0]!.stop = vi.fn(async () => {
        throw new Error("boom");
      });
      await expect(runtime.stopAll(handles)).resolves.toBeUndefined();
    });
  });

  describe("when events() is called", () => {
    it("returns the same AsyncIterable across calls within a single ctx", () => {
      const ctx = fakeCtx();
      const a = runtime.events(ctx);
      const b = runtime.events(ctx);
      expect(a).toBe(b);
    });

    it("emits starting+healthy events for every service that starts", async () => {
      const ctx = fakeCtx();
      const events = runtime.events(ctx);
      const collected: RuntimeEvent[] = [];
      const collector = (async () => {
        for await (const ev of events) {
          collected.push(ev);
          if (collected.filter((e) => e.type === "healthy").length >= 8) break;
        }
      })();
      await runtime.startAll(ctx);
      // Watchdog: if a regression makes one of the supervised services
      // skip its "healthy" emit, the collector loop above will block
      // forever waiting for the 7th event. Race against a 5s timeout so
      // the test fails loud instead of hanging the runner.
      await Promise.race([
        collector,
        new Promise<void>((_, reject) =>
          setTimeout(
            () =>
              reject(
                new Error(
                  `runtime.events collector did not see 8 healthy events within 5s — got ${
                    collected.filter((e) => e.type === "healthy").length
                  }`,
                ),
              ),
            5_000,
          ),
        ),
      ]);
      const startingServices = collected
        .filter((e) => e.type === "starting")
        .map((e) => (e as { service: string }).service);
      expect(startingServices).toEqual(
        expect.arrayContaining([
          "postgres",
          "redis",
          "clickhouse",
          "langyagent",
          "nlpgo",
          "langevals",
          "aigateway",
          "langwatch",
        ]),
      );
    });
  });
});
