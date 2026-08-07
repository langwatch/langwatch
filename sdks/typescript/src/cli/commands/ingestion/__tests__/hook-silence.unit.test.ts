/**
 * The two promises the session context hook makes to every session it runs in:
 * nothing on stdout ever, and never a reason the session stalls or fails.
 *
 * A SessionStart hook's stdout is injected into the user's session context, so
 * a stray line would land in the model's prompt. Everything it cannot act on
 * (no repository, an unreadable payload, a tool it has no hook for, a collector
 * that refuses the post, a pipe nobody closes) has to end the same way: quietly
 * and soon.
 *
 * Feature: specs/ai-governance/cli-wrappers/session-context-hook.feature
 */

import { PassThrough } from "node:stream";

import { describe, expect, it } from "vitest";

import { readStdin } from "../hook-input";
import { installHookHarness, unreachableCollector } from "./hook-harness";

const hook = installHookHarness();
const { posted } = hook;

/** Far more than a session payload holds, on a pipe the seam keeps open. */
const oversizedWrite = () => {
  const stream = new PassThrough();
  stream.write(`{"session_id":"${"x".repeat(128 * 1024)}"}`);
  return stream;
};

describe("the session context hook's silence", () => {
  describe("given a directory that is not a git repository", () => {
    /** @scenario "Outside a git repository the hook sends nothing and exits zero" */
    it("posts nothing, records nothing and exits zero", async () => {
      await hook.runHook({ git: {} });

      expect(posted).toEqual([]);
      expect(hook.stdout).toEqual([]);
      expect(hook.exits).toEqual([]);
    });

    it("posts nothing when the origin remote names no repository", async () => {
      await hook.runHook({ git: { "remote get-url origin": "/srv/git/bare.git" } });

      expect(posted).toEqual([]);
    });
  });

  describe("given a telemetry endpoint that cannot be reached", () => {
    /** @scenario "The hook never writes to stdout even when the post fails" */
    it("writes nothing to stdout and exits zero", async () => {
      await hook.runHook({ fetchImpl: unreachableCollector });

      expect(hook.stdout).toEqual([]);
      expect(hook.exits).toEqual([]);
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

      await expect(readStdin({ stream, timeoutMs: 20 })).resolves.toBe(
        '{"session_id":"',
      );
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

      await expect(readStdin({ stream, timeoutMs: 5_000 })).resolves.toBe(
        '{"session_id":"abc"}',
      );
    });
  });

  describe("given a seam writing far more than a payload holds", () => {
    /** @scenario "An oversized payload sends no session context and leaves the session undisturbed" */
    it("posts nothing, writes nothing and exits zero", async () => {
      await hook.runHook({
        readInput: () =>
          readStdin({ stream: oversizedWrite(), timeoutMs: 5_000 }),
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
