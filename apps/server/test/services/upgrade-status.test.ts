import { createServer, type AddressInfo } from "node:net";

import { afterEach, describe, expect, it, vi } from "vitest";

import type * as NodeDeps from "../../src/services/node-deps.ts";

const execaCalls: { command: string; args: string[]; cwd?: string }[] = [];
const databaseUrls: (string | undefined)[] = [];

type ExecaOptions = { cwd?: string; env?: Record<string, string | undefined> };

vi.mock("execa", () => ({
  execa: vi.fn(async (command: string, args: string[], options: ExecaOptions) => {
    execaCalls.push({ command, args, cwd: options.cwd });
    databaseUrls.push(options.env?.DATABASE_URL);
    return { exitCode: 0, stdout: "Installation: Up to date (neutral)", stderr: "" };
  }),
}));

vi.mock("../../src/services/node-deps.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof NodeDeps>()),
  resolvePnpm: async () => ({ command: "/opt/langwatch/bin/pnpm", args: [] }),
}));

const { locateTasksDir } = await import("../../src/services/node-deps.ts");
const { printUpgradeStatus, upgradeStatusDatabaseUrl } =
  await import("../../src/services/upgrade-status.ts");
const { allocatePorts } = await import("../../src/shared/ports.ts");

const closers: (() => Promise<void>)[] = [];

afterEach(async () => {
  execaCalls.length = 0;
  databaseUrls.length = 0;
  vi.restoreAllMocks();
  await Promise.all(closers.splice(0).map((close) => close()));
});

async function listeningPort(): Promise<number> {
  const listener = createServer();
  await new Promise<void>((ready) => listener.listen(0, "127.0.0.1", ready));
  closers.push(() => new Promise<void>((done) => listener.close(() => done())));
  return (listener.address() as AddressInfo).port;
}

describe("doctor's upgrade status", () => {
  describe("when the local database accepts connections", () => {
    /** @scenario "Doctor prints the upgrade status of an installation whose database is running" */
    it("runs the tasks app's upgrade status through pnpm and prints what it prints", async () => {
      const printed: string[] = [];
      vi.spyOn(console, "log").mockImplementation((line: string) => void printed.push(line));

      const port = await listeningPort();
      await printUpgradeStatus({
        databaseUrl: `postgresql://langwatch@127.0.0.1:${port}/langwatch_db?schema=langwatch_db`,
      });

      expect(execaCalls).toEqual([
        {
          command: "/opt/langwatch/bin/pnpm",
          args: ["--silent", "run", "task", "upgrade", "status"],
          cwd: locateTasksDir(),
        },
      ]);
      expect(printed).toContain("  Installation: Up to date (neutral)");
      expect(printed.join("\n")).not.toContain("status unavailable");
    });
  });

  describe("when the install brought its own Postgres", () => {
    /** @scenario "Doctor checks the databases the install uses" */
    it("checks and reads the ledger from their Postgres URL, not the bundled one", async () => {
      vi.spyOn(console, "log").mockImplementation(() => undefined);
      const ports = allocatePorts(5560);
      const own = `postgresql://me@127.0.0.1:${await listeningPort()}/mine`;

      const databaseUrl = upgradeStatusDatabaseUrl({ env: { DATABASE_URL: own }, ports });
      await printUpgradeStatus({ databaseUrl });

      expect(databaseUrl).toBe(own);
      expect(databaseUrls).toEqual([own]);
    });
  });

  describe("when the install runs the bundled Postgres", () => {
    /** @scenario "Doctor checks the databases the install uses" */
    it("reads the ledger from the bundled port", () => {
      const ports = allocatePorts(5560);
      const env = {
        DATABASE_URL: `postgresql://langwatch@localhost:${ports.postgres}/langwatch_db`,
      };

      expect(upgradeStatusDatabaseUrl({ env, ports })).toContain(`@127.0.0.1:${ports.postgres}/`);
    });
  });
});
