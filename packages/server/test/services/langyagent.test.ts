import { beforeEach, describe, expect, it, vi } from "vitest";
import { EventBus } from "../../src/services/event-bus.ts";
import type { RuntimeContext } from "../../src/shared/runtime-contract.ts";

const superviseMock = vi.fn((_input: { spec: { env: NodeJS.ProcessEnv } }) => ({
  name: "langyagent",
  pid: 42,
  child: null,
  stop: vi.fn(async () => {}),
}));

vi.mock("../../src/services/spawn.ts", () => ({
  supervise: superviseMock,
}));
vi.mock("../../src/services/health.ts", () => ({
  httpGetCheck: vi.fn(() => vi.fn()),
  pollUntilHealthy: vi.fn(async () => ({ ok: true })),
}));
vi.mock("../../src/services/paths.ts", () => ({
  servicePaths: vi.fn(() => ({ logs: "/tmp/logs" })),
}));

const { startLangyagent } = await import("../../src/services/langyagent.ts");

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
        resolvedPath: "/tmp/.langwatch-test/bin/aigateway",
        preInstalled: false,
      },
      "langy-worker": {
        version: "0.1.0",
        resolvedPath: "/tmp/.langwatch-test/bin/langy-worker",
        preInstalled: false,
      },
    },
    envFile: "/tmp/.langwatch-test/.env",
    version: "test",
    userEnv: {},
  };
}

describe("startLangyagent", () => {
  beforeEach(() => {
    superviseMock.mockClear();
  });

  it("gives the manager the exact worker binary installed for this release", async () => {
    await startLangyagent(fakeCtx(), new EventBus(), {});

    const call = superviseMock.mock.calls[0]![0];
    expect(call.spec.env.LANGY_PI_WORKER_BINARY_PATH).toBe(
      "/tmp/.langwatch-test/bin/langy-worker",
    );
  });

  it("fails before spawning a manager that cannot run a conversation", async () => {
    const ctx = fakeCtx();
    delete ctx.predeps["langy-worker"];

    await expect(
      startLangyagent(ctx, new EventBus(), {}),
    ).rejects.toThrow("langy-worker predep not resolved");
    expect(superviseMock).not.toHaveBeenCalled();
  });
});
