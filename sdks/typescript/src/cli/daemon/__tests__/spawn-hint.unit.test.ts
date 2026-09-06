import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import type { DaemonIdentity } from "../identity";
import { recordMissAndDecideToSpawn } from "../spawn-hint";

describe("recordMissAndDecideToSpawn", () => {
  let identity: DaemonIdentity;
  let root: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "lw-hint-"));
    identity = {
      fingerprint: "a".repeat(64),
      socketDir: path.join(root, "sockets"),
      socketPath: path.join(root, "sockets", "aaaaaaaaaaaaaaaa.sock"),
      endpoint: "https://app.example.test",
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    fs.rmSync(root, { recursive: true, force: true });
  });

  describe("given a one-off command", () => {
    describe("when the CLI misses the daemon once", () => {
      it("does not spawn one, so a single command never leaves a process behind", () => {
        expect(recordMissAndDecideToSpawn(identity)).toBe(false);
      });
    });
  });

  describe("given an agent calling the CLI repeatedly", () => {
    describe("when the CLI misses twice in quick succession", () => {
      it("spawns a daemon for the calls that follow", () => {
        expect(recordMissAndDecideToSpawn(identity)).toBe(false);
        expect(recordMissAndDecideToSpawn(identity)).toBe(true);
      });

      it("does not immediately ask for another one", () => {
        recordMissAndDecideToSpawn(identity);
        expect(recordMissAndDecideToSpawn(identity)).toBe(true);
        // The evidence was consumed: a daemon that is slow to boot must not make
        // every subsequent invocation spawn a competing one.
        expect(recordMissAndDecideToSpawn(identity)).toBe(false);
      });
    });
  });

  describe("given two one-off commands a long time apart", () => {
    describe("when the second miss lands outside the window", () => {
      it("treats them as two one-offs and spawns nothing", () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date("2026-07-11T10:00:00Z"));
        expect(recordMissAndDecideToSpawn(identity)).toBe(false);

        vi.setSystemTime(new Date("2026-07-11T10:05:00Z"));
        expect(recordMissAndDecideToSpawn(identity)).toBe(false);
      });
    });
  });

  describe("given the hint file is corrupt", () => {
    describe("when a miss is recorded", () => {
      it("recovers instead of breaking the command", () => {
        fs.mkdirSync(identity.socketDir, { recursive: true, mode: 0o700 });
        fs.writeFileSync(
          path.join(identity.socketDir, "aaaaaaaaaaaaaaaa.hint"),
          "not json at all",
        );

        expect(() => recordMissAndDecideToSpawn(identity)).not.toThrow();
      });
    });
  });

  describe("given two different identities", () => {
    describe("when each misses once", () => {
      it("counts them separately", () => {
        const other: DaemonIdentity = {
          ...identity,
          fingerprint: "b".repeat(64),
          socketPath: path.join(identity.socketDir, "bbbbbbbbbbbbbbbb.sock"),
        };

        expect(recordMissAndDecideToSpawn(identity)).toBe(false);
        expect(recordMissAndDecideToSpawn(other)).toBe(false);
      });
    });
  });

  describe("given a socket directory owned by another user", () => {
    describe("when a miss is recorded", () => {
      it("refuses to spawn, because that daemon's socket could never be private", () => {
        fs.mkdirSync(identity.socketDir, { recursive: true, mode: 0o777 });
        // chown needs root; moving OUR uid makes the same comparison fail.
        vi.spyOn(process, "getuid").mockReturnValue(
          (process.getuid?.() ?? 0) + 1,
        );

        expect(recordMissAndDecideToSpawn(identity)).toBe(false);
        expect(recordMissAndDecideToSpawn(identity)).toBe(false);
        // Not even the bookkeeping: nothing of ours goes into that directory.
        expect(fs.readdirSync(identity.socketDir)).toEqual([]);
      });
    });
  });

  describe("when the hint file is written", () => {
    it("is 0600, like everything else beside the socket", () => {
      recordMissAndDecideToSpawn(identity);

      const file = path.join(identity.socketDir, "aaaaaaaaaaaaaaaa.hint");
      expect((fs.statSync(file).mode & 0o777).toString(8)).toBe("600");
    });
  });
});
