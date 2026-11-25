/**
 * Session context hook promises: silent on stdout, never blocks the session.
 * Feature: specs/ai-governance/cli-wrappers/session-context-hook.feature
 */

import { PassThrough } from "node:stream";

import { describe, expect, it } from "vitest";

import { HOOK_TIMEOUT_SECONDS } from "@/cli/utils/governance/session-context-agents";

import { HOOK_BUDGET_MS, runHookProcess } from "../hook";
import { readStdin } from "../hook-input";
import {
  ENDPOINT,
  gitRunner,
  installHookHarness,
  NO_CLI_CONFIG,
  SESSION_ID,
  unreachableCollector,
  WORKTREE_GIT,
} from "./hook-harness";

const hook = installHookHarness();
const { posted } = hook;

/** The hook as its own process, ending through `exits` rather than this test's. */
const runHookProcessWith = async ({
  fetchImpl,
  budgetMs,
}: {
  fetchImpl: typeof fetch;
  budgetMs?: number;
}): Promise<number[]> => {
  const exits: number[] = [];
  await runHookProcess({
    tool: "copilot",
    env: { OTEL_EXPORTER_OTLP_ENDPOINT: ENDPOINT, COPILOT_CLI: "1" },
    readInput: () => Promise.resolve(JSON.stringify({ sessionId: SESSION_ID, cwd: "/repo" })),
    runGit: gitRunner(WORKTREE_GIT),
    fetchImpl,
    stateDir: hook.stateDir,
    readCliConfig: NO_CLI_CONFIG,
    healRevokedKey: async () => ({ status: "declined" }) as const,
    ...(budgetMs === undefined ? {} : { budgetMs }),
    exit: (code) => exits.push(code),
  });
  return exits;
};

/** A collector that never answers and ignores being given up on. */
const silentCollector: typeof fetch = (() => new Promise<never>(() => undefined)) as typeof fetch;

/** Far more than a session payload holds, on a pipe the seam keeps open. */
const oversizedWrite = () => {
  const stream = new PassThrough();
  stream.write(`{"session_id":"${"x".repeat(128 * 1024)}"}`);
  return stream;
};

describe("the session context hook's silence", () => {
  describe("given a directory that is not a git repository", () => {
    /** @scenario "Outside a git repository with nothing to declare the hook sends nothing and exits zero" */
    it("posts nothing, records nothing and exits zero", async () => {
      await hook.runHook({ git: {} });

      expect(posted).toEqual([]);
      expect(hook.stdout).toEqual([]);
      expect(hook.exits).toEqual([]);
    });

    /** @scenario "A blank name is no name" */
    it("treats a whitespace session title as nothing to say", async () => {
      await hook.runHook({
        git: {},
        input: {
          session_id: SESSION_ID,
          cwd: "/repo/worktrees/review",
          session_title: "   ",
        },
      });

      expect(posted).toEqual([]);
      expect(hook.exits).toEqual([]);
    });

    it("posts nothing when the origin remote names no repository", async () => {
      await hook.runHook({ git: { "remote get-url origin": "/srv/git/bare.git" } });

      expect(posted).toEqual([]);
    });
  });

  describe("given a telemetry endpoint that cannot be reached", () => {
    /** @scenario "The hook writes nothing to stdout when the post fails" */
    it("writes nothing to stdout and exits zero", async () => {
      await hook.runHook({ fetchImpl: unreachableCollector });

      expect(hook.stdout).toEqual([]);
      expect(hook.exits).toEqual([]);
    });
  });

  describe("given a post given up with its connection attempt still open", () => {
    /** @scenario "The hook process ends once its work is done, with a connection still open" */
    it("ends the process itself with exit code zero and nothing on stdout", async () => {
      // What an aborted fetch leaves behind: a handle that keeps node alive.
      const connecting = setInterval(() => undefined, 60_000);
      try {
        const exits = await runHookProcessWith({ fetchImpl: unreachableCollector });

        expect(exits).toEqual([0]);
        expect(hook.stdout).toEqual([]);
      } finally {
        clearInterval(connecting);
      }
    });
  });

  describe("given a hook still waiting on the collector when its budget runs out", () => {
    /** @scenario "The hook process ends inside the agent's hook timeout whatever it waits on" */
    it("ends the process at the budget with exit code zero and nothing on stdout", async () => {
      const startedAt = Date.now();
      const exits = await runHookProcessWith({ fetchImpl: silentCollector, budgetMs: 50 });

      expect(exits).toEqual([0]);
      expect(hook.stdout).toEqual([]);
      expect(Date.now() - startedAt).toBeLessThan(1_000);
    });

    /** @scenario "The hook process ends inside the agent's hook timeout whatever it waits on" */
    it("keeps the budget at least three seconds inside the agent's timeout", () => {
      expect(HOOK_BUDGET_MS).toBeLessThanOrEqual((HOOK_TIMEOUT_SECONDS - 3) * 1_000);
    });
  });

  describe("given input or a tool the hook cannot act on", () => {
    it.each([
      ["empty stdin", ""],
      ["stdin that is not json", "not json at all"],
      ["a json array", "[]"],
      ["half a payload", '{"session_id":"'],
    ])("stays silent on %s", async (_label, input) => {
      await hook.runHook({ input });

      expect(posted).toEqual([]);
      expect(hook.stdout).toEqual([]);
      expect(hook.exits).toEqual([]);
    });

    it("stays silent for a tool it has no hook for", async () => {
      await hook.runHook({ tool: "gemini" });

      expect(posted).toEqual([]);
      expect(hook.stdout).toEqual([]);
      expect(hook.exits).toEqual([]);
    });

    /** @scenario "A seam that fires with no session id sends nothing and exits zero" */
    it("stays silent when the payload carries no session id", async () => {
      await hook.runHook({ input: { cwd: "/repo/worktrees/review" } });

      expect(posted).toEqual([]);
      expect(hook.stdout).toEqual([]);
      expect(hook.exits).toEqual([]);
    });
  });

  describe("given a seam that never closes the hook's stdin", () => {
    /** @scenario "A payload that never arrives does not outlive the session" */
    it("stops waiting at the deadline and keeps what arrived", async () => {
      const stream = new PassThrough();
      stream.write('{"session_id":"');

      await expect(readStdin({ stream, timeoutMs: 20 })).resolves.toBe('{"session_id":"');
    });

    /** @scenario "A payload that never arrives does not outlive the session" */
    it("releases the pipe, so it cannot hold the process open", async () => {
      const stream = new PassThrough();

      await readStdin({ stream, timeoutMs: 20 });

      expect(stream.destroyed).toBe(true);
    });

    it("reads a payload that does arrive without waiting for the deadline", async () => {
      const stream = new PassThrough();
      stream.end('{"session_id":"abc"}');

      await expect(readStdin({ stream, timeoutMs: 5_000 })).resolves.toBe('{"session_id":"abc"}');
    });
  });

  describe("given a seam writing far more than a payload holds", () => {
    /** @scenario "An oversized payload sends no session context and leaves the session undisturbed" */
    it("posts nothing, writes nothing and exits zero", async () => {
      await hook.runHook({
        readInput: () => readStdin({ stream: oversizedWrite(), timeoutMs: 5_000 }),
      });

      expect(posted).toEqual([]);
      expect(hook.stdout).toEqual([]);
      expect(hook.exits).toEqual([]);
    });

    it("stops at the cap and releases the pipe rather than buffering the write", async () => {
      const stream = oversizedWrite();

      await expect(readStdin({ stream, timeoutMs: 5_000 })).resolves.toBe("");
      expect(stream.destroyed).toBe(true);
    });
  });

  describe("given a terminal rather than a hook payload", () => {
    it("reads as empty without waiting at all", async () => {
      const stream = Object.assign(new PassThrough(), { isTTY: true });

      await expect(readStdin({ stream, timeoutMs: 5_000 })).resolves.toBe("");
      expect(stream.destroyed).toBe(false);
    });
  });
});
