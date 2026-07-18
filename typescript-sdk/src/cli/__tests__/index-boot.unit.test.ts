/**
 * The CLI entrypoint loads .env BEFORE anything else — except when the
 * process being booted IS the daemon server. That boot runs with cwd=$HOME
 * (daemon/spawn.ts), and its process env becomes the baseline every request
 * resets to, so loading ~/.env there would drop home-directory secrets into
 * every caller's execution window.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

const dotenvConfigMock = vi.hoisted(() => vi.fn());
vi.mock("dotenv", () => ({ config: dotenvConfigMock }));

const runCliMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock("../daemon/dispatch", () => ({ runCli: runCliMock }));

describe("the CLI boot (index.ts)", () => {
  const savedArgv = process.argv;

  beforeEach(() => {
    // index.ts runs its boot logic at import time; re-import fresh per argv.
    vi.resetModules();
    dotenvConfigMock.mockClear();
    runCliMock.mockClear();
  });

  afterEach(() => {
    process.argv = savedArgv;
  });

  const boot = (argv: string[]): Promise<unknown> => {
    process.argv = argv;
    return import("../index.js");
  };

  describe("given a normal invocation", () => {
    it("loads .env before dispatching", async () => {
      await boot(["node", "cli.js", "trace", "search"]);

      expect(dotenvConfigMock).toHaveBeenCalled();
      expect(runCliMock).toHaveBeenCalled();
    });
  });

  describe("given the daemon-server boot (daemon start --foreground)", () => {
    it("does NOT load ~/.env", async () => {
      await boot(["node", "cli.js", "daemon", "start", "--foreground"]);

      expect(dotenvConfigMock).not.toHaveBeenCalled();
      expect(runCliMock).toHaveBeenCalled();
    });
  });
});
