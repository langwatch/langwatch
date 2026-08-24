/**
 * Declarations queued when the agent's own shell could not reach the
 * collector: what is kept, what is dropped, and what a drain records.
 *
 * Feature: specs/ai-governance/cli-wrappers/session-context-declare.feature
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { readFingerprint, stateFilePath } from "../hook-state";
import {
  drainSessionContextSpool,
  fallbackSpoolDir,
  readSpooledDeclarations,
  SPOOL_MAX_ENTRIES,
  spoolDir,
  spoolFileName,
  spoolFilePath,
  writeSpooledDeclaration,
} from "../session-context-spool";

const NOW = 1_700_000_000_000;

let stateDir: string;
let tmpRoot: string;
let previousTmpdir: string | undefined;

beforeEach(() => {
  stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "lw-spool-"));
  // The fallback queue lives in the temp directory, so every test gets its
  // own rather than sharing the one on this machine.
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "lw-spool-tmp-"));
  previousTmpdir = process.env.TMPDIR;
  process.env.TMPDIR = tmpRoot;
});

afterEach(() => {
  if (previousTmpdir === undefined) delete process.env.TMPDIR;
  else process.env.TMPDIR = previousTmpdir;
  fs.rmSync(stateDir, { recursive: true, force: true });
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

function queue({
  sessionId,
  now = NOW,
  agent = "codex",
}: {
  sessionId: string;
  now?: number;
  agent?: string;
}): void {
  writeSpooledDeclaration({
    stateDir,
    agent,
    sessionId,
    fingerprint: `fingerprint-${sessionId}`,
    payload: { session: sessionId },
    now: () => now,
  });
}

describe("the declaration spool", () => {
  describe("when a session declares twice before either is sent", () => {
    /** @scenario "A declaration that cannot be delivered is queued, not lost" */
    it("keeps one entry, the newer one", () => {
      queue({ sessionId: "a", now: NOW - 1_000 });
      writeSpooledDeclaration({
        stateDir,
        agent: "codex",
        sessionId: "a",
        fingerprint: "newer",
        payload: { session: "a-newer" },
        now: () => NOW,
      });

      const entries = readSpooledDeclarations({ stateDir, now: () => NOW });
      expect(entries).toHaveLength(1);
      expect(entries[0]!.fingerprint).toBe("newer");
    });
  });

  describe("when an entry is older than an hour", () => {
    /** @scenario "An expired queued declaration is dropped without posting" */
    it("is dropped from disk and never offered for sending", async () => {
      queue({ sessionId: "stale", now: NOW - 61 * 60_000 });
      queue({ sessionId: "fresh", now: NOW });
      const sent: unknown[] = [];

      await drainSessionContextSpool({
        stateDir,
        now: () => NOW,
        post: async (payload) => {
          sent.push(payload);
          return true;
        },
      });

      expect(sent).toEqual([{ session: "fresh" }]);
      expect(
        fs.existsSync(
          spoolFilePath({ stateDir, agent: "codex", sessionId: "stale" }),
        ),
      ).toBe(false);
    });
  });

  describe("when more entries pile up than the directory may hold", () => {
    it("keeps the newest and prunes the rest", () => {
      for (let index = 0; index < SPOOL_MAX_ENTRIES + 10; index++) {
        queue({ sessionId: `s${index}`, now: NOW - index });
      }

      expect(readSpooledDeclarations({ stateDir, now: () => NOW })).toHaveLength(
        SPOOL_MAX_ENTRIES,
      );
    });
  });

  describe("when a drain delivers an entry", () => {
    /** @scenario "The next session report sends the queued declaration" */
    it("removes it and records the declared fingerprint", async () => {
      queue({ sessionId: "a" });

      const delivered = await drainSessionContextSpool({
        stateDir,
        now: () => NOW,
        post: async () => true,
      });

      expect(delivered).toBe(1);
      expect(readSpooledDeclarations({ stateDir, now: () => NOW })).toEqual([]);
      expect(
        readFingerprint(
          stateFilePath({ stateDir, agent: "codex", sessionId: "a" }),
        ),
      ).toBe("fingerprint-a");
    });
  });

  describe("when the send fails", () => {
    /** @scenario "A queued declaration survives a failed send" */
    it("keeps the entry and records no fingerprint", async () => {
      queue({ sessionId: "a" });

      const delivered = await drainSessionContextSpool({
        stateDir,
        now: () => NOW,
        post: async () => false,
      });

      expect(delivered).toBe(0);
      expect(readSpooledDeclarations({ stateDir, now: () => NOW })).toHaveLength(
        1,
      );
      expect(
        readFingerprint(
          stateFilePath({ stateDir, agent: "codex", sessionId: "a" }),
        ),
      ).toBeNull();
    });
  });

  describe("when the send throws", () => {
    /** @scenario "A queued declaration survives a failed send" */
    it("keeps the entry instead of letting the seam fail", async () => {
      queue({ sessionId: "a" });

      await expect(
        drainSessionContextSpool({
          stateDir,
          now: () => NOW,
          post: async () => {
            throw new Error("no network in this sandbox");
          },
        }),
      ).resolves.toBe(0);

      expect(readSpooledDeclarations({ stateDir, now: () => NOW })).toHaveLength(
        1,
      );
    });
  });

  describe("when an entry on disk is unreadable", () => {
    it("drops it rather than offer a declaration it cannot trust", () => {
      queue({ sessionId: "a" });
      const file = spoolFilePath({ stateDir, agent: "codex", sessionId: "a" });
      fs.writeFileSync(file, "not json at all");

      expect(readSpooledDeclarations({ stateDir, now: () => NOW })).toEqual([]);
      expect(fs.existsSync(file)).toBe(false);
    });
  });

  describe("when the state directory cannot be written, as under a sandbox", () => {
    /** @scenario "A sandboxed declaration is queued where the sandbox allows" */
    it("queues in the temp directory and a drain still finds it", async () => {
      // A file where the spool directory should go: mkdir fails the way the
      // sandbox's EPERM does, without needing a sandbox to reproduce.
      fs.writeFileSync(spoolDir(stateDir), "not a directory");
      const sent: unknown[] = [];

      writeSpooledDeclaration({
        stateDir,
        agent: "codex",
        sessionId: "sandboxed",
        fingerprint: "sandboxed-fingerprint",
        payload: { session: "sandboxed" },
        now: () => NOW,
      });

      expect(
        fs.existsSync(
          path.join(
            fallbackSpoolDir(),
            spoolFileName({ agent: "codex", sessionId: "sandboxed" }),
          ),
        ),
      ).toBe(true);

      await drainSessionContextSpool({
        stateDir,
        now: () => NOW,
        post: async (payload) => {
          sent.push(payload);
          return true;
        },
      });

      expect(sent).toEqual([{ session: "sandboxed" }]);
      expect(
        readFingerprint(
          stateFilePath({ stateDir, agent: "codex", sessionId: "sandboxed" }),
        ),
      ).toBe("sandboxed-fingerprint");
    });

    it("refuses the temp queue when anyone else could write to it", async () => {
      fs.writeFileSync(spoolDir(stateDir), "not a directory");
      writeSpooledDeclaration({
        stateDir,
        agent: "codex",
        sessionId: "sandboxed",
        fingerprint: "sandboxed-fingerprint",
        payload: { session: "sandboxed" },
        now: () => NOW,
      });
      fs.chmodSync(fallbackSpoolDir(), 0o777);

      expect(readSpooledDeclarations({ stateDir, now: () => NOW })).toEqual([]);
    });
  });

  describe("when nothing was ever queued", () => {
    it("drains nothing and posts nothing", async () => {
      const sent: unknown[] = [];

      const delivered = await drainSessionContextSpool({
        stateDir,
        now: () => NOW,
        post: async (payload) => {
          sent.push(payload);
          return true;
        },
      });

      expect(delivered).toBe(0);
      expect(sent).toEqual([]);
    });
  });
});
