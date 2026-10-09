/**
 * Which codex session is live: the one hot rollout inside the window, because
 * codex exports nothing about itself into the processes a session spawns.
 * Two hot rollouts mean two sessions asking at once and resolve to nothing.
 *
 * Feature: specs/ai-governance/cli-wrappers/session-context-declare.feature
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  type CodexSessionResolution,
  resolveLiveCodexSession,
} from "../codex-live-session";

/** The resolved session, or a readable failure naming what came back instead. */
function sessionOf(resolution: CodexSessionResolution) {
  if (resolution.kind !== "session") {
    throw new Error(`expected a session, got ${resolution.kind}`);
  }
  return resolution.session;
}

const NOW = 1_700_000_000_000;
const SESSION_A = "0199a1f4-2c5e-7a10-9f61-2d7f0a3b5c11";
const SESSION_B = "0199a1f4-2c5e-7a10-9f61-2d7f0a3b5c22";
const SESSION_C = "0199a1f4-2c5e-7a10-9f61-2d7f0a3b5c33";

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
  dir: day = "22",
}: {
  sessionId: string;
  agoMs: number;
  lines?: string[];
  filename?: string;
  dir?: string;
}): string {
  const dir = path.join(sessionsRoot, "2026", "08", day);
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

      expect(sessionOf(live).sessionId).toBe(SESSION_A);
      expect(sessionOf(live).meta?.firstUserMessage).toBe("review the auth PR");
    });
  });

  describe("when two sessions are hot at the same time", () => {
    /** @scenario "Two simultaneously active codex sessions declare nothing" */
    it("resolves to no session and names the ones it could not tell apart", async () => {
      writeRollout({ sessionId: SESSION_A, agoMs: 5_000 });
      writeRollout({ sessionId: SESSION_B, agoMs: 20_000 });

      const live = await resolveLiveCodexSession({ sessionsRoot, nowMs: NOW });

      expect(live.kind).toBe("ambiguous");
      expect(live.kind === "ambiguous" && live.sessionIds).toEqual(
        [SESSION_A, SESSION_B].sort(),
      );
    });
  });

  describe("when one session is hot and the others are only stale-recent", () => {
    /** @scenario "The session in the middle of a turn wins over an idle one" */
    it("resolves the hot one", async () => {
      writeRollout({ sessionId: SESSION_A, agoMs: 10 * 60_000 });
      writeRollout({ sessionId: SESSION_C, agoMs: 4 * 60_000 });
      writeRollout({ sessionId: SESSION_B, agoMs: 5_000 });

      const live = await resolveLiveCodexSession({ sessionsRoot, nowMs: NOW });

      expect(sessionOf(live).sessionId).toBe(SESSION_B);
    });
  });

  describe("when codex was restarted and the dead session is still recent", () => {
    /** @scenario "A codex restart still resolves without flags" */
    it("resolves the running session with no flags", async () => {
      writeRollout({ sessionId: SESSION_A, agoMs: 3 * 60_000 });
      writeRollout({ sessionId: SESSION_B, agoMs: 2_000 });

      const live = await resolveLiveCodexSession({ sessionsRoot, nowMs: NOW });

      expect(sessionOf(live).sessionId).toBe(SESSION_B);
    });
  });

  describe("when several rollouts are recent but none is hot", () => {
    /** @scenario "Two simultaneously active codex sessions declare nothing" */
    it("resolves to no session rather than pick the newest", async () => {
      writeRollout({ sessionId: SESSION_A, agoMs: 10 * 60_000 });
      writeRollout({ sessionId: SESSION_B, agoMs: 5 * 60_000 });

      const live = await resolveLiveCodexSession({ sessionsRoot, nowMs: NOW });

      expect(live.kind).toBe("ambiguous");
    });
  });

  describe("when one session left two rollouts behind", () => {
    it("counts them as one session and resolves it", async () => {
      writeRollout({ sessionId: SESSION_A, agoMs: 6 * 60_000 });
      writeRollout({ sessionId: SESSION_A, agoMs: 5_000, dir: "23" });

      const live = await resolveLiveCodexSession({ sessionsRoot, nowMs: NOW });

      expect(sessionOf(live).sessionId).toBe(SESSION_A);
    });
  });

  describe("when the only rollout is older than the window", () => {
    /** @scenario "A stale rollout does not resolve" */
    it("resolves nothing", async () => {
      writeRollout({ sessionId: SESSION_A, agoMs: 16 * 60_000 });

      const live = await resolveLiveCodexSession({ sessionsRoot, nowMs: NOW });

      expect(live.kind).toBe("none");
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

      expect(sessionOf(live).sessionId).toBe(SESSION_A);
      expect(sessionOf(live).meta).toBeNull();
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

      expect(sessionOf(live).sessionId).toBe(SESSION_A);
    });
  });

  describe("when there are no rollouts at all", () => {
    it("resolves nothing", async () => {
      const live = await resolveLiveCodexSession({ sessionsRoot, nowMs: NOW });

      expect(live.kind).toBe("none");
    });
  });
});
