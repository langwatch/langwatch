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
        crashed: false,
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
const goStub = makeStub("go");
const langevalsStub = makeStub("langevals");
const langwatchStub = makeStub("langwatch");
const langyStub = makeStub("langyagent");

const venvsFn = vi.fn(async () => {
  callLog.push("venvs");
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
vi.mock("../../src/services/go-services.ts", () => ({
  startGoServices: vi.fn(async (...args: Parameters<typeof goStub.fn>) => [
    await goStub.fn(...args),
  ]),
}));
vi.mock("../../src/services/langevals.ts", () => ({
  startLangevals: langevalsStub.fn,
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
vi.mock("../../src/services/venvs.ts", () => ({ syncVenvs: venvsFn }));
vi.mock("../../src/services/app-dir.ts", () => ({
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
      workerHealth: 5565,
      backend: 5566,
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
      development: { aiGatewayDevBuild: false, forceBundledPostgres: false, appArchive: undefined },
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
      goStub.fn,
      langevalsStub.fn,
      langwatchStub.fn,
      venvsFn,
      langyCliFn,
    ].forEach((fn) => fn.mockClear());
  });

  describe("when installServices is called", () => {
    it("prepares only the uv environment and the tokenizer cache: the app tree is already in place", async () => {
      await runtime.installServices(fakeCtx());
      expect(venvsFn).toHaveBeenCalledTimes(1);
      // The assistant's CLI download depends on the feature toggles, not on the app tree.
      expect(callLog.filter((entry) => entry !== "langy-cli")).toEqual(["venvs"]);
    });
  });

  describe("when startAll is called", () => {
    it("starts the Go services and the backend after the stores, with no migration phase", async () => {
      const ctx = fakeCtx();
      const handles = await runtime.startAll(ctx);
      expect(handles).toHaveLength(7);
      const positions: Record<string, number> = {};
      callLog.forEach((entry, idx) => {
        if (!(entry in positions)) positions[entry] = idx;
      });
      const infraEnd = Math.max(
        positions["start:postgres"]!,
        positions["start:redis"]!,
        positions["start:clickhouse"]!,
      );
      expect(callLog).not.toContain("migrate");
      expect(positions["start:go"]).toBeGreaterThan(infraEnd);
      expect(positions["start:langwatch"]).toBeGreaterThan(infraEnd);
      // The assistant first, so the app is told whether it is there.
      expect(positions["start:langwatch"]).toBeGreaterThan(positions["start:langyagent"]!);
      // LangEvals after its environment, and on nothing else.
      expect(positions["start:langevals"]).toBeGreaterThan(positions.venvs!);
    });

    it("runs the api and the worker as the one langwatch process, with no second worker spawn", async () => {
      const handles = await runtime.startAll(fakeCtx());
      const names = handles.map((h) => h.name);
      expect(names.filter((name) => name === "langwatch")).toHaveLength(1);
      expect(names).not.toContain("workers");
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

  describe("when the user's shell carries a provider key", () => {
    /** @scenario "The ai-gateway sees the same environment as the other app-tier services" */
    it("hands the ai-gateway the same env as the other app-tier services", async () => {
      const ctx = fakeCtx();
      ctx.userEnv = { OPENAI_API_KEY: "sk-user" };
      await runtime.startAll(ctx);
      const gatewayEnv = goStub.fn.mock.calls.at(-1)![2];
      const appEnv = langwatchStub.fn.mock.calls.at(-1)![2];
      expect(gatewayEnv).toEqual(appEnv);
      expect(gatewayEnv).toMatchObject({ OPENAI_API_KEY: "sk-user" });
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

      // A sibling still booting at the failure is stopped the moment it comes up.
      await vi.waitFor(() => {
        for (const sibling of ["go", "langevals"]) {
          expect(callLog).toContain(`stop:${sibling}`);
        }
        // Infra + the assistant come down with them.
        for (const infra of ["postgres", "redis", "clickhouse", "langyagent"]) {
          expect(callLog).toContain(`stop:${infra}`);
        }
      });
    });
  });

  describe("when one infrastructure service dies during boot", () => {
    /** @scenario "A service that dies during initial boot is not restarted" */
    it("stops the infrastructure that did start and starts no app tier", async () => {
      clickhouseStub.fn.mockImplementationOnce(async () => {
        callLog.push("start:clickhouse");
        throw new Error("clickhouse did not become ready: exited before healthy");
      });

      await expect(runtime.startAll(fakeCtx())).rejects.toThrow("clickhouse");

      await vi.waitFor(() => {
        expect(callLog).toContain("stop:postgres");
        expect(callLog).toContain("stop:redis");
      });
      expect(callLog).not.toContain("start:langwatch");
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
        expect(handles).toHaveLength(6);
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
        LANGY_AGENT_URL: "http://localhost:5564",
        FEATURE_FLAG_FORCE_ENABLE: "release_langy_enabled,other_flag",
      };
      try {
        await runtime.startAll(fakeCtx());
        const childEnv = langwatchStub.fn.mock.calls.at(-1)![2] as Record<string, string>;
        expect(childEnv.LANGY_AGENT_URL).toBeUndefined();
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
      expect(handles).toHaveLength(6);
      // The app is told the assistant is off, not left pointing at a corpse.
      const childEnv = langwatchStub.fn.mock.calls.at(-1)![2] as Record<string, string>;
      expect(childEnv.LANGWATCH_ENABLE_LANGY).toBe("false");
      expect(childEnv.LANGY_AGENT_URL).toBeUndefined();
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
      expect(stopOrder).toHaveLength(7);
      // The backend drains before the stores it writes to go down.
      for (const store of ["postgres", "redis", "clickhouse"]) {
        expect(stopOrder.indexOf("stop:langwatch")).toBeLessThan(
          stopOrder.indexOf(`stop:${store}`),
        );
      }
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
          if (collected.filter((e) => e.type === "healthy").length >= 7) break;
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
                  `runtime.events collector did not see 7 healthy events within 5s — got ${
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
          "go",
          "langevals",
          "langwatch",
        ]),
      );
    });
  });
});

/** Each predep resolves only when the test says so, as the CLI's gate does. */
function gatedCtx() {
  const ctx = fakeCtx();
  const arrived = new Set<string>();
  const waiting: { ids: readonly string[]; resolve: () => void }[] = [];
  ctx.predepsReady = (ids) =>
    new Promise<void>((resolve) => {
      waiting.push({ ids, resolve });
      arrive();
    });
  const arrive = (...ids: string[]) => {
    for (const id of ids) arrived.add(id);
    for (const wait of waiting.splice(0)) {
      if (wait.ids.every((id) => arrived.has(id))) wait.resolve();
      else waiting.push(wait);
    }
  };
  return { ctx, arrive };
}

describe("services/runtime while the predeps are still arriving", () => {
  beforeEach(() => {
    langyBinarySupported = true;
    callLog.length = 0;
    venvsFn.mockClear();
    langevalsStub.fn.mockClear();
  });

  /** @scenario "The stores start while the app is still arriving" */
  it("starts the stores and the Go services before the app is in place, and the backend only after", async () => {
    const { ctx, arrive } = gatedCtx();
    const booting = runtime.startAll(ctx);

    arrive("postgres", "redis", "clickhouse", "aigateway", "pnpm", "opencode");
    await vi.waitFor(() => expect(callLog).toContain("start:go"));
    expect(callLog).toEqual(
      expect.arrayContaining(["start:postgres", "start:redis", "start:clickhouse"]),
    );
    expect(callLog).not.toContain("start:langwatch");
    expect(callLog).not.toContain("start:langevals");

    arrive("app", "uv");
    await booting;
    expect(callLog).toContain("start:langwatch");
  });

  /** @scenario "The backend does not wait for LangEvals" */
  it("starts the backend while LangEvals' environment is still being prepared", async () => {
    const { ctx, arrive } = gatedCtx();
    let finishVenvs = () => {};
    venvsFn.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          callLog.push("venvs");
          finishVenvs = resolve;
        }),
    );
    const booting = runtime.startAll(ctx);

    arrive("postgres", "redis", "clickhouse", "aigateway", "pnpm", "opencode", "app", "uv");
    await vi.waitFor(() => expect(callLog).toContain("start:langwatch"));
    expect(callLog).not.toContain("start:langevals");

    finishVenvs();
    await booting;
    expect(callLog).toContain("start:langevals");
  });

  /** @scenario "LangEvals failing its first boot still takes the stack down" */
  it("stops every service that started when LangEvals never comes up", async () => {
    langevalsStub.fn.mockImplementationOnce(async () => {
      callLog.push("start:langevals");
      throw new Error("langevals did not become healthy: timed out");
    });

    await expect(runtime.startAll(fakeCtx())).rejects.toThrow("langevals");
    // A service still booting when LangEvals failed is stopped the moment it comes up.
    await vi.waitFor(() => {
      const started = callLog
        .filter((entry) => entry.startsWith("start:") && entry !== "start:langevals")
        .map((entry) => entry.slice("start:".length));
      expect(started).toContain("postgres");
      for (const service of started) expect(callLog).toContain(`stop:${service}`);
    });
  });
});

describe("services/runtime with a database the person brings", () => {
  beforeEach(() => {
    langyBinarySupported = true;
    callLog.length = 0;
  });

  /** @scenario "A database they bring is neither downloaded nor started" */
  it("starts no Postgres and waits on no Postgres predep, and runs Redis and ClickHouse bundled", async () => {
    envFileContent = { DATABASE_URL: "postgresql://me@db.internal:5432/langwatch" };
    const { ctx, arrive } = gatedCtx();
    try {
      const booting = runtime.startAll(ctx);
      arrive("redis", "clickhouse", "aigateway", "pnpm", "opencode", "app", "uv");
      const handles = await booting;

      expect(callLog).not.toContain("start:postgres");
      expect(callLog).toEqual(expect.arrayContaining(["start:redis", "start:clickhouse"]));
      expect(handles.map((handle) => handle.name)).toContain("langwatch");
    } finally {
      envFileContent = {};
    }
  });
});
