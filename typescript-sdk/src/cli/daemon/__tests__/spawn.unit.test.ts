/**
 * The spawned daemon's boot environment becomes the BASELINE every request
 * resets to (execution.ts applyWindow), so it must be a known-safe set — never
 * the spawner's full shell env, which would leak one project's variables into
 * every other caller's requests.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

const spawnMock = vi.hoisted(() =>
  vi.fn(
    (
      _file: string,
      _args: string[],
      _options: { env: Record<string, string> },
    ) => ({ unref: vi.fn(), on: vi.fn() }),
  ),
);
vi.mock("node:child_process", () => ({ spawn: spawnMock }));

import { spawnDaemon } from "../spawn";
import type { DaemonIdentity } from "../identity";

const identity: DaemonIdentity = {
  fingerprint: "f".repeat(64),
  socketPath: "/tmp/lw-test.sock",
  socketDir: "/tmp",
  endpoint: "https://app.langwatch.ai",
};

const spawnedEnv = (): Record<string, string> => {
  const calls = spawnMock.mock.calls;
  const call = calls[calls.length - 1];
  if (!call) throw new Error("spawn was not called");
  return call[2].env;
};

describe("spawnDaemon", () => {
  const MARKER = "LW_SPAWN_TEST_SECRET";

  beforeEach(() => {
    process.env[MARKER] = "leak-me";
    spawnMock.mockClear();
  });

  afterEach(() => {
    delete process.env[MARKER];
  });

  describe("given a spawner whose shell is full of unrelated variables", () => {
    it("does not hand them to the daemon", () => {
      spawnDaemon({ cliPath: "/cli.js", env: {}, identity });

      expect(spawnedEnv()).not.toHaveProperty(MARKER);
    });
  });

  describe("given the process essentials", () => {
    it("keeps PATH and HOME so the daemon can function", () => {
      spawnDaemon({ cliPath: "/cli.js", env: {}, identity });

      const env = spawnedEnv();
      expect(env.PATH).toBe(process.env.PATH);
      expect(env.HOME).toBe(process.env.HOME);
    });
  });

  describe("given the identity the daemon must serve", () => {
    it("pins the identity triple and the no-recursion guard", () => {
      spawnDaemon({
        cliPath: "/cli.js",
        env: { LANGWATCH_API_KEY: "sk-caller" },
        identity,
      });

      const env = spawnedEnv();
      expect(env.LANGWATCH_ENDPOINT).toBe("https://app.langwatch.ai");
      expect(env.LANGWATCH_API_KEY).toBe("sk-caller");
      expect(env.LANGWATCH_NO_DAEMON).toBe("1");
    });

    it("keeps the caller's allowlisted overlay", () => {
      spawnDaemon({
        cliPath: "/cli.js",
        env: { FORCE_COLOR: "3" },
        identity,
      });

      expect(spawnedEnv().FORCE_COLOR).toBe("3");
    });
  });

  describe("when the spawn itself fails asynchronously", () => {
    it("swallows the child's error event instead of crashing the caller", () => {
      // EAGAIN under fork pressure arrives as an `error` EVENT, not a throw;
      // an unhandled one would kill the caller's CLI process.
      spawnDaemon({ cliPath: "/cli.js", env: {}, identity });

      const child = spawnMock.mock.results[0]?.value as {
        on: ReturnType<typeof vi.fn>;
      };
      expect(child.on).toHaveBeenCalledWith("error", expect.any(Function));
    });
  });
});
