/**
 * Running commands in a shared folder, with real child processes in a real
 * temporary directory: the cap, the timeout, the process group and the
 * background process that outlives the session.
 */

import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BASH_OUTPUT_CAP_BYTES } from "../../../../agent/local-control-protocol";
import { LocalCallFailure } from "../errors";
import {
  excludeLogDirFromGit,
  killGroup,
  logPathFor,
  startCommand,
  timeoutMsFor,
} from "../executor";

const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

const settle = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

/** Waits for a condition rather than for a fixed time, so a busy machine is fine. */
const waitUntil = async (
  ready: () => boolean,
  { timeoutMs = 10_000, what = "the condition" } = {},
): Promise<void> => {
  const deadline = Date.now() + timeoutMs;
  while (!ready()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await settle(25);
  }
};

describe("given a shared folder", () => {
  let root: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "langy-exec-"));
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  describe("when a command runs to its end", () => {
    it("returns its exit code, its output and how long it took", async () => {
      const command = startCommand({
        command: "echo hello && echo oops >&2",
        root,
        callId: "call-1",
      });
      const output = await command.result;
      expect(output.exitCode).toBe(0);
      expect(output.stdout).toContain("hello");
      expect(output.stderr).toContain("oops");
      expect(output.truncated).toBe(false);
      expect(output.durationMs).toBeGreaterThanOrEqual(0);
      expect(fs.readFileSync(output.logPath!, "utf8")).toContain("hello");
    });

    it("runs in the shared folder", async () => {
      const command = startCommand({ command: "pwd", root, callId: "call-2" });
      const output = await command.result;
      expect(output.stdout.trim()).toBe(fs.realpathSync(root));
    });

    it("reports a failing command by its exit code, not as an error", async () => {
      const command = startCommand({
        command: "exit 3",
        root,
        callId: "call-3",
      });
      const output = await command.result;
      expect(output.exitCode).toBe(3);
    });
  });

  describe("when a command writes more than the cap", () => {
    it("cuts the text, says so, and keeps the whole log in the folder", async () => {
      const command = startCommand({
        command: `head -c ${BASH_OUTPUT_CAP_BYTES * 2} /dev/zero | tr '\\0' 'x'`,
        root,
        callId: "call-4",
      });
      const output = await command.result;
      expect(output.truncated).toBe(true);
      expect(output.stdout).toContain("The whole log is at");
      expect(output.stdout.length).toBeLessThan(BASH_OUTPUT_CAP_BYTES * 1.1);
      const log = fs.statSync(output.logPath!);
      expect(log.size).toBeGreaterThan(BASH_OUTPUT_CAP_BYTES);
    });
  });

  describe("when a command passes its timeout", () => {
    it("stops it and says the limit was passed", async () => {
      const command = startCommand({
        command: "sleep 30",
        root,
        callId: "call-5",
        timeout: 0.3,
      });
      await expect(command.result).rejects.toBeInstanceOf(LocalCallFailure);
      await command.result.catch((error: LocalCallFailure) => {
        expect(error.code).toBe("timeout");
        expect(error.message).toContain("limit");
      });
    });

    it("keeps the timeout inside the platform's window", () => {
      expect(timeoutMsFor(undefined)).toBe(5 * 60 * 1000);
      expect(timeoutMsFor(30)).toBe(30_000);
      expect(timeoutMsFor(3_600)).toBe(15 * 60 * 1000);
      expect(timeoutMsFor(0)).toBe(5 * 60 * 1000);
    });
  });

  describe("when a command is cancelled", () => {
    it("kills the process and everything it started", async () => {
      const command = startCommand({
        command: "sleep 30 & echo $! > child.pid; wait",
        root,
        callId: "call-6",
      });
      const pidFile = path.join(root, "child.pid");
      await waitUntil(
        () => fs.existsSync(pidFile) && fs.readFileSync(pidFile, "utf8").trim() !== "",
        { what: "the child to write its pid" },
      );
      const childPid = Number(fs.readFileSync(pidFile, "utf8").trim());
      expect(alive(childPid)).toBe(true);
      command.cancel();
      await expect(command.result).rejects.toBeInstanceOf(LocalCallFailure);
      await waitUntil(() => !alive(childPid), { what: "the child to end" });
    });
  });

  describe("when Langy starts a command in the background", () => {
    /** @scenario "A background process Langy started outlives the command" */
    it("returns the process id and the log path at once and leaves it running", async () => {
      const command = startCommand({
        command: "for i in 1 2 3; do echo tick; sleep 0.2; done",
        root,
        callId: "call-7",
        background: true,
      });
      const output = await command.result;
      expect(output.pid).toBeGreaterThan(0);
      expect(output.exitCode).toBeNull();
      expect(output.logPath).toBe(logPathFor({ root, callId: "call-7" }));
      expect(alive(output.pid!)).toBe(true);

      await waitUntil(
        () => fs.readFileSync(output.logPath!, "utf8").includes("tick"),
        { what: "the background process to write its log" },
      );
      killGroup(output.pid);
    });
  });

  describe("when the folder is a git repository", () => {
    /** @scenario "The log directory is kept out of git" */
    it("excludes the log directory through the repository's own exclude file", async () => {
      execFileSync("git", ["init", "-q"], { cwd: root });
      const command = startCommand({ command: "echo hi", root, callId: "call-8" });
      await command.result;
      const exclude = fs.readFileSync(
        path.join(root, ".git", "info", "exclude"),
        "utf8",
      );
      expect(exclude).toContain(".langwatch/");
      expect(
        execFileSync("git", ["status", "--porcelain"], {
          cwd: root,
          encoding: "utf8",
        }),
      ).not.toContain(".langwatch");
    });

    it("writes the entry once, however often the session runs", () => {
      execFileSync("git", ["init", "-q"], { cwd: root });
      excludeLogDirFromGit(root);
      excludeLogDirFromGit(root);
      excludeLogDirFromGit(root);
      const lines = fs
        .readFileSync(path.join(root, ".git", "info", "exclude"), "utf8")
        .split("\n")
        .filter((line) => line.trim() === ".langwatch/");
      expect(lines).toHaveLength(1);
    });
  });

  describe("when the folder is not a git repository", () => {
    it("runs the command anyway", async () => {
      const command = startCommand({ command: "echo hi", root, callId: "call-9" });
      const output = await command.result;
      expect(output.exitCode).toBe(0);
    });
  });
});
