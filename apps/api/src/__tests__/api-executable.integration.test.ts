/**
 * The api executable (`startApi`, what `main.ts` runs) started over the local Postgres, Redis and
 * a migrated ClickHouse (ARCHITECTURE.md §7: one store tier per process). Every secret is a
 * synthetic test value: nothing here is read from `.env`.
 * @vitest-environment node
 * @see specs/server/api-process-executable.feature
 */
import { spawn } from "node:child_process";
import { connect } from "node:net";
import { fileURLToPath } from "node:url";

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { startApi } from "../main.ts";
import {
  freePort,
  liveDatabaseUrl,
  liveStoresConfigured,
  SYNTHETIC_ENVIRONMENT,
} from "./api-live.fixture.ts";
import { startMigratedClickHouseEndpoint } from "./monitor-performance.fixture.ts";

const BOOT_TIMEOUT_MS = 120_000;
const MAIN_ENTRY = fileURLToPath(new URL("../main.ts", import.meta.url));

/** True when something accepts a connection on the port. */
function listensOn(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ port, host: "127.0.0.1" });
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => resolve(false));
  });
}

let clickHouseUrl = "";

beforeAll(async () => {
  if (!liveStoresConfigured) return;
  clickHouseUrl = (await startMigratedClickHouseEndpoint()).url;
}, BOOT_TIMEOUT_MS);

/** The deployment's environment for the executable, with `overrides` on top. */
function stubDeployment({
  port,
  overrides = {},
}: {
  port: number;
  overrides?: Readonly<Record<string, string>>;
}) {
  const baseUrl = `http://127.0.0.1:${port}`;
  const environment = {
    ...SYNTHETIC_ENVIRONMENT,
    BASE_HOST: baseUrl,
    NEXTAUTH_URL: baseUrl,
    API_PORT: String(port),
    DATABASE_URL: liveDatabaseUrl(),
    REDIS_URL: process.env.LANGWATCH_TEST_REDIS_URL ?? "",
    CLICKHOUSE_URL: clickHouseUrl,
    ...overrides,
  };
  for (const [name, value] of Object.entries(environment)) vi.stubEnv(name, value);
  return baseUrl;
}

describe.skipIf(!liveStoresConfigured)("the api executable over live stores", () => {
  afterEach(() => vi.unstubAllEnvs());

  describe("given a deployment that supplies no product service adapters", () => {
    let baseUrl = "";
    let server: Awaited<ReturnType<typeof startApi>>;

    beforeAll(async () => {
      baseUrl = stubDeployment({ port: await freePort() });
      server = await startApi({ ownsProcess: false, ownsTelemetry: false });
    }, BOOT_TIMEOUT_MS);

    afterAll(async () => {
      await server?.close();
    });

    /** @scenario "The start command boots the production composition" */
    it("serves the product's routes over its own configuration, not a lifecycle-only graph", async () => {
      const document = await fetch(`${baseUrl}/api/openapi.json`);
      expect(document.status).toBe(200);
      const published = (await document.json()) as { paths: Record<string, unknown> };
      expect(Object.keys(published.paths).length).toBeGreaterThan(50);

      const productRoute = await fetch(`${baseUrl}/api/gateway/v1/virtual-keys`);
      expect(productRoute.status).toBe(401);
    });

    /** @scenario "The started process answers its health route" */
    it("answers the health route successfully with no body", async () => {
      const response = await fetch(`${baseUrl}/api/health`);

      expect(response.ok).toBe(true);
      await expect(response.text()).resolves.toBe("");
    });
  });

  describe("given a process whose readiness has not yet passed", () => {
    /** @scenario "The listener stays closed until readiness has passed" */
    it(
      "refuses every connection to its port until the boot resolves, then accepts",
      async () => {
        const port = await freePort();
        stubDeployment({ port });
        const probes: boolean[] = [];
        let booted = false;
        const polling = (async () => {
          while (!booted) {
            probes.push(await listensOn(port));
            await new Promise((resolve) => setTimeout(resolve, 1));
          }
        })();

        const server = await startApi({ ownsProcess: false, ownsTelemetry: false });
        booted = true;
        await polling;

        try {
          const firstAccepted = probes.indexOf(true);
          const refusedWhileComposing = firstAccepted === -1 ? probes.length : firstAccepted;
          expect(refusedWhileComposing).toBeGreaterThan(2);
          expect(probes.slice(refusedWhileComposing).every((accepted) => accepted)).toBe(true);
          await expect(listensOn(port)).resolves.toBe(true);
        } finally {
          await server.close();
        }
      },
      BOOT_TIMEOUT_MS,
    );
  });

  describe("given an executable that installed its shutdown signal handlers", () => {
    /** @scenario "The signal handlers the executable installed are removed when it closes" */
    it(
      "leaves the host with the handlers it held before the start",
      async () => {
        const before = {
          term: process.listenerCount("SIGTERM"),
          int: process.listenerCount("SIGINT"),
        };
        const port = await freePort();
        stubDeployment({ port });
        const server = await startApi({ ownsProcess: true, ownsTelemetry: false });

        try {
          expect(process.listenerCount("SIGTERM")).toBeGreaterThan(before.term);
          expect(process.listenerCount("SIGINT")).toBeGreaterThan(before.int);
        } finally {
          await server.close();
        }

        expect(process.listenerCount("SIGTERM")).toBe(before.term);
        expect(process.listenerCount("SIGINT")).toBe(before.int);
      },
      BOOT_TIMEOUT_MS,
    );
  });
});

describe("the api executable run as its own process", () => {
  describe("given a deployment whose environment carries an invalid configuration value", () => {
    /** @scenario "A failed boot is reported on the process's error stream" */
    it(
      "writes the refusal to stderr, message first, and exits non-zero",
      async () => {
        const child = spawn(process.execPath, ["--experimental-transform-types", MAIN_ENTRY], {
          env: { ...process.env, API_PORT: "not-a-port" },
          stdio: ["ignore", "pipe", "pipe"],
        });
        let stderr = "";
        let stdout = "";
        child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
        child.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString()));
        const exitCode = await new Promise<number | null>((resolve) =>
          child.once("close", (code) => resolve(code)),
        );

        expect(exitCode).not.toBe(0);
        expect(exitCode).not.toBeNull();
        expect(stdout).toBe("");
        expect(stderr).toMatch(
          /ConfigParseError: Configuration refused:\s+process\.port ← API_PORT/,
        );
      },
      BOOT_TIMEOUT_MS,
    );
  });
});
