import { beforeEach, describe, expect, it, vi } from "vitest";

import { EventBus } from "../../src/services/event-bus.ts";
import { startGoServices } from "../../src/services/go-services.ts";
import type { RuntimeContext } from "../../src/shared/runtime-contract.ts";

const { binary, supervise, separate, probedUrls } = vi.hoisted(() => {
  const handle = (name: string) => ({ name, pid: 1, stop: vi.fn(async () => {}) });
  return {
    binary: { usage: "" },
    supervise: vi.fn(
      (_args: { spec: { name: string; args: string[]; env: Record<string, string> } }) =>
        handle("go"),
    ),
    separate: {
      nlpgo: vi.fn(async () => handle("nlpgo")),
      aigateway: vi.fn(async () => handle("aigateway")),
    },
    probedUrls: new Array<string>(),
  };
});

vi.mock("execa", () => ({
  execa: vi.fn(async () => ({ stdout: "", stderr: binary.usage })),
}));
vi.mock("../../src/services/spawn.ts", () => ({ supervise }));
vi.mock("../../src/services/nlpgo.ts", () => ({ startNlpgo: separate.nlpgo }));
vi.mock("../../src/services/aigateway.ts", () => ({ startAigateway: separate.aigateway }));
vi.mock("../../src/services/health.ts", () => ({
  httpGetCheck: (url: string) => {
    probedUrls.push(url);
    return async () => ({ ok: true, durationMs: 0 });
  },
  pollUntilHealthy: async () => ({ ok: true, durationMs: 1 }),
}));

const COMBINED_USAGE =
  "usage: service <command> [args...]\navailable: aigateway langyagent nlpgo combined";
const OLDER_USAGE = "usage: service <command> [args...]\navailable: aigateway langyagent nlpgo";

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
    predeps: {
      aigateway: { version: "test", resolvedPath: "/fake/bin/aigateway", preInstalled: false },
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

describe("startGoServices", () => {
  beforeEach(() => {
    probedUrls.length = 0;
    supervise.mockClear();
    separate.nlpgo.mockClear();
    separate.aigateway.mockClear();
  });

  describe("when the release binary offers combined mode", () => {
    beforeEach(() => {
      binary.usage = COMBINED_USAGE;
    });

    /** @scenario "nlpgo and the ai-gateway run as one Go process when the binary has combined mode" */
    it("spawns nlpgo and the ai-gateway once, as one combined process", async () => {
      const handles = await startGoServices(fakeCtx(), new EventBus(), {});

      expect(handles.map((h) => h.name)).toEqual(["go"]);
      expect(supervise).toHaveBeenCalledTimes(1);
      expect(supervise.mock.calls[0]![0].spec.args).toEqual(["combined", "nlpgo", "aigateway"]);
      expect(separate.nlpgo).not.toHaveBeenCalled();
      expect(separate.aigateway).not.toHaveBeenCalled();
    });

    /** @scenario "nlpgo and the ai-gateway run as one Go process when the binary has combined mode" */
    it("gives each service its own port and points both back at the app", async () => {
      await startGoServices(fakeCtx(), new EventBus(), { OPENAI_API_KEY: "sk-user" });

      expect(supervise.mock.calls[0]![0].spec.env).toMatchObject({
        LANGWATCH_GO_NLPGO_ADDR: ":5561",
        LANGWATCH_GO_AIGATEWAY_ADDR: ":5563",
        NLPGO_ENGINE_LANGWATCH_BASE_URL: "http://127.0.0.1:5560",
        LW_GATEWAY_BASE_URL: "http://127.0.0.1:5560",
        OPENAI_API_KEY: "sk-user",
      });
    });

    /** @scenario "nlpgo and the ai-gateway run as one Go process when the binary has combined mode" */
    it("waits for both services' health doors", async () => {
      await startGoServices(fakeCtx(), new EventBus(), {});

      expect(probedUrls).toEqual([
        "http://127.0.0.1:5561/healthz",
        "http://127.0.0.1:5563/healthz",
      ]);
    });
  });

  describe("when the release binary predates combined mode", () => {
    /** @scenario "An older monobinary still gets nlpgo and the ai-gateway as two processes" */
    it("starts nlpgo and the ai-gateway as two processes, as before", async () => {
      binary.usage = OLDER_USAGE;

      const handles = await startGoServices(fakeCtx(), new EventBus(), {});

      expect(handles.map((h) => h.name)).toEqual(["nlpgo", "aigateway"]);
      expect(supervise).not.toHaveBeenCalled();
    });
  });
});
