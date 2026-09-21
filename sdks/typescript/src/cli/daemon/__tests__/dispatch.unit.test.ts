/**
 * @see sdks/typescript/specs/cli/daemon.feature - A daemon that stops answering
 *
 * The client reports a wedged daemon and marks the outcome for eviction, but
 * the eviction itself happens here in the dispatcher. Asserting the flag alone
 * would pass with the `requestStop` call deleted, and the next command would
 * then wedge on the same daemon.
 */
(globalThis as Record<string, unknown>).__CLI_VERSION__ ??= "0.0.0-test";

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../client", () => ({
  execViaDaemon: vi.fn(),
  requestStop: vi.fn(async () => undefined),
}));

vi.mock("../identity", () => ({
  resolveIdentity: () => ({
    fingerprint: "a".repeat(64),
    socketPath: "/tmp/lw-test/aaaaaaaaaaaaaaaa.sock",
    socketDir: "/tmp/lw-test",
    endpoint: "https://app.example.test",
  }),
  isDaemonSocketPathUsable: () => true,
  resolveBuildId: () => "test-build",
}));

vi.mock("../eligibility", () => ({
  evaluateEligibility: () => ({ eligible: true }),
  collectForwardedEnv: () => ({}),
  isAutoSpawnEnabled: () => false,
  isDaemonDisabledByConfig: () => false,
  resolveColorLevel: () => 0,
  stdinCarriesData: () => false,
}));

import { execViaDaemon, requestStop } from "../client";
import { runCli } from "../dispatch";

const ARGV = ["node", "/usr/local/bin/langwatch", "ui", "call", "workbench.run"];

describe("given a daemon served the command", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.exitCode = undefined;
  });

  describe("when the client gave up on it and marked it for eviction", () => {
    /** @scenario "A wedged daemon is not left for the next command" */
    it("asks that daemon to stop, and does not run the command again", async () => {
      vi.mocked(execViaDaemon).mockResolvedValue({
        served: true,
        exitCode: 124,
        evict: true,
      });

      await runCli(ARGV);

      expect(requestStop).toHaveBeenCalledWith(
        "/tmp/lw-test/aaaaaaaaaaaaaaaa.sock",
      );
      expect(execViaDaemon).toHaveBeenCalledTimes(1);
      expect(process.exitCode).toBe(124);
    });
  });

  describe("when the command finished normally", () => {
    it("leaves the daemon running for the next command", async () => {
      vi.mocked(execViaDaemon).mockResolvedValue({ served: true, exitCode: 0 });

      await runCli(ARGV);

      expect(requestStop).not.toHaveBeenCalled();
      expect(process.exitCode).toBe(0);
    });
  });
});
