/**
 * Which codex session is live: the rollout written to most recently inside
 * the window, because codex exports nothing about itself into the processes
 * a session spawns.
 *
 * Feature: specs/ai-governance/cli-wrappers/session-context-declare.feature
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { resolveLiveCodexSession } from "../codex-live-session";

const NOW = 1_700_000_000_000;
const SESSION_A = "0199a1f4-2c5e-7a10-9f61-2d7f0a3b5c11";
const SESSION_B = "0199a1f4-2c5e-7a10-9f61-2d7f0a3b5c22";

let sessionsRoot: string;

beforeEach(() => {
  sessionsRoot = fs.mkdtempSync(path.join(os.tmpdir(), "lw-codex-sessions-"));
});

afterEach(() => {
  fs.rmSync(sessionsRoot, { recursive: true, force: true });
});

function writeRollout({
  sessionId,
  agoMs,
  lines,
  filename,
}: {
  sessionId: string;
  agoMs: number;
  lines?: string[];
  filename?: string;
}): string {
  const dir = path.join(sessionsRoot, "2026", "08", "22");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(
    dir,
    filename ?? `rollout-2026-08-22T10-00-00-${sessionId}.jsonl`,
  );
  fs.writeFileSync(
    file,
    (
      lines ?? [
        JSON.stringify({
          type: "session_meta",
          payload: {
            id: sessionId,
            cwd: "/scratch",
            git: {
              branch: "main",
              repository_url: "git@github.com:acme/api.git",
            },
          },
        }),
        JSON.stringify({
          type: "event_msg",
          payload: { type: "user_message", message: "review the auth PR" },
        }),
      ]
    ).join("\n"),
  );
  const mtime = new Date(NOW - agoMs);
  fs.utimesSync(file, mtime, mtime);
  return file;
}

describe("resolving the live codex session", () => {
  describe("when one rollout was written inside the window", () => {
    it("resolves its session id from the filename and parses its meta", async () => {
      writeRollout({ sessionId: SESSION_A, agoMs: 60_000 });

      const live = await resolveLiveCodexSession({ sessionsRoot, nowMs: NOW });

      expect(live?.sessionId).toBe(SESSION_A);
      expect(live?.meta?.firstUserMessage).toBe("review the auth PR");
    });
  });

  describe("when two rollouts are active inside the window", () => {
    /** @scenario "Two recently-active rollouts resolve to the newest" */
    it("resolves to the most recently written one", async () => {
      writeRollout({ sessionId: SESSION_A, agoMs: 10 * 60_000 });
      writeRollout({ sessionId: SESSION_B, agoMs: 60_000 });

      const live = await resolveLiveCodexSession({ sessionsRoot, nowMs: NOW });

      expect(live?.sessionId).toBe(SESSION_B);
    });
  });

  describe("when the only rollout is older than the window", () => {
    /** @scenario "A stale rollout does not resolve" */
    it("resolves nothing", async () => {
      writeRollout({ sessionId: SESSION_A, agoMs: 16 * 60_000 });

      const live = await resolveLiveCodexSession({ sessionsRoot, nowMs: NOW });

      expect(live).toBeNull();
    });
  });

  describe("when the transcript does not parse", () => {
    it("still names the session from the filename", async () => {
      writeRollout({
        sessionId: SESSION_A,
        agoMs: 60_000,
        lines: ["this is not json"],
      });

      const live = await resolveLiveCodexSession({ sessionsRoot, nowMs: NOW });

      expect(live?.sessionId).toBe(SESSION_A);
      expect(live?.meta).toBeNull();
    });
  });

  describe("when the filename does not carry the session id", () => {
    it("falls back to the transcript's session_meta line", async () => {
      writeRollout({
        sessionId: SESSION_A,
        agoMs: 60_000,
        filename: "rollout-oddly-named.jsonl",
      });

      const live = await resolveLiveCodexSession({ sessionsRoot, nowMs: NOW });

      expect(live?.sessionId).toBe(SESSION_A);
    });
  });

  describe("when there are no rollouts at all", () => {
    it("resolves nothing", async () => {
      const live = await resolveLiveCodexSession({ sessionsRoot, nowMs: NOW });

      expect(live).toBeNull();
    });
  });
});
