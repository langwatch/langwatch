/**
 * The socket-file bookkeeping: which FILE a path leads to, and whether this
 * process is allowed to remove it.
 *
 * Real files, no sockets — the lifecycle these rules protect is exercised over
 * real sockets in daemon-server.integration.test.ts.
 */
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { stagingSocketPath, unlinkIfSameFile } from "../server";

const identify = (filePath: string): { dev: number; ino: number } => {
  const stat = fs.statSync(filePath);
  return { dev: stat.dev, ino: stat.ino };
};

describe("unlinkIfSameFile", () => {
  let dir: string;
  let filePath: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "lw-sock-"));
    filePath = path.join(dir, "identity.sock");
    fs.writeFileSync(filePath, "mine");
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  describe("given the path still leads to the recorded file", () => {
    it("removes it", () => {
      expect(unlinkIfSameFile(filePath, identify(filePath))).toBe(true);
      expect(fs.existsSync(filePath)).toBe(false);
    });
  });

  describe("given the file was replaced by another under the same path", () => {
    it("leaves the replacement alone", () => {
      const mine = identify(filePath);

      // Hold the original inode open for the duration, which is what the real
      // daemon does — its socket is still bound while it decides whether to
      // unlink the shared name. That is load-bearing, not test scaffolding:
      // an inode with no remaining reference is free for immediate reuse, and
      // Linux DOES reuse the number, so without a live handle the successor's
      // file can land on the same (dev, ino) and the guard cannot tell the two
      // apart. Keeping ours open is what makes the identity meaningful.
      const held = fs.openSync(filePath, "r");
      try {
        // What a successor daemon does: unlink the corpse, bind its own.
        fs.unlinkSync(filePath);
        fs.writeFileSync(filePath, "theirs");
        const theirs = identify(filePath);

        expect(unlinkIfSameFile(filePath, mine)).toBe(false);
        expect(fs.existsSync(filePath)).toBe(true);
        expect(identify(filePath)).toEqual(theirs);
      } finally {
        fs.closeSync(held);
      }
    });
  });

  describe("given nothing was ever recorded", () => {
    it("removes nothing, so a daemon that never published cannot delete one that did", () => {
      expect(unlinkIfSameFile(filePath, null)).toBe(false);
      expect(fs.existsSync(filePath)).toBe(true);
    });
  });

  describe("given the file is already gone", () => {
    it("reports nothing was removed rather than throwing", () => {
      const mine = identify(filePath);
      fs.unlinkSync(filePath);

      expect(unlinkIfSameFile(filePath, mine)).toBe(false);
    });
  });
});

describe("stagingSocketPath", () => {
  const shared = "/run/user/501/langwatch-501/0123456789abcdef.sock";

  describe("given the shared socket path", () => {
    it("stays in the same directory, so publishing is a same-filesystem link", () => {
      expect(path.dirname(stagingSocketPath(shared, 4242))).toBe(
        path.dirname(shared),
      );
    });

    it("gives two daemons racing to start different files to bind", () => {
      expect(stagingSocketPath(shared, 101)).not.toBe(
        stagingSocketPath(shared, 102),
      );
      expect(stagingSocketPath(shared, 101)).not.toBe(shared);
    });

    it("stays within the sockaddr_un budget the shared path was sized against", () => {
      // The staging path is the one handed to bind(), so it — not the shared
      // path — is what has to fit. Worst case is the longest pid a platform
      // can issue (7 digits on Linux) standing in for `.sock`.
      const widest = stagingSocketPath(shared, 4194304);

      expect(
        Buffer.byteLength(widest, "utf8") - Buffer.byteLength(shared, "utf8"),
      ).toBeLessThanOrEqual(3);
    });
  });

  describe("given a socket path that does not end in .sock", () => {
    it("still produces a distinct path rather than colliding with it", () => {
      const odd = "/tmp/langwatch-501/socket";

      expect(stagingSocketPath(odd, 7)).not.toBe(odd);
      expect(path.dirname(stagingSocketPath(odd, 7))).toBe(path.dirname(odd));
    });
  });
});
