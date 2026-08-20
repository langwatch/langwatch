/**
 * The socket-file bookkeeping: which FILE a path leads to, whether this process
 * is allowed to remove it, and how a bound socket takes on the shared name.
 *
 * Real files, no sockets — the lifecycle these rules protect is exercised over
 * real sockets in daemon-server.integration.test.ts. The one call this file
 * replaces is `fs.linkSync`: publishing has a fallback precisely for a
 * filesystem that refuses to hard-link a socket, and no filesystem a test can
 * create here behaves that way.
 */

// The mock factory below needs the module's type. A top-level `import type`
// gives it that without an inline `import()` annotation: the CLI's exception
// for inline imports covers load-bearing LAZY RUNTIME imports that keep the
// boot graph small, not a type argument, which costs nothing to hoist.
import type * as NodeFs from "node:fs";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MAX_STAGING_OVERHEAD_BYTES } from "../identity";
import {
  DaemonAlreadyRunningError,
  publishSocket,
  stagingSocketPath,
  unlinkIfSameFile,
} from "../server";

const { refuseLink } = vi.hoisted(() => ({
  refuseLink: { code: null as string | null },
}));

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof NodeFs>();
  const linkSync: typeof actual.linkSync = (existingPath, newPath) => {
    if (refuseLink.code === null) {
      actual.linkSync(existingPath, newPath);
      return;
    }
    const error: NodeJS.ErrnoException = new Error(
      `${refuseLink.code}: operation not permitted, link`,
    );
    error.code = refuseLink.code;
    throw error;
  };
  return { ...actual, default: { ...actual, linkSync }, linkSync };
});

/**
 * The identity the production code records, reproduced here: `lstat`, so a
 * symlink is identified as the LINK — the file `unlink(2)` would remove — and
 * not as whatever it points at. Identical to `stat` for every plain file below.
 */
const identify = (filePath: string): { dev: number; ino: number } => {
  const stat = fs.lstatSync(filePath);
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

  describe("given a file this process recorded as its own", () => {
    describe("when the path still leads to that file", () => {
      it("removes it", () => {
        expect(unlinkIfSameFile(filePath, identify(filePath))).toBe(true);
        expect(fs.existsSync(filePath)).toBe(false);
      });
    });

    describe("when another file has taken the path over", () => {
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

    describe("when the file is already gone", () => {
      it("reports nothing was removed rather than throwing", () => {
        const mine = identify(filePath);
        fs.unlinkSync(filePath);

        expect(unlinkIfSameFile(filePath, mine)).toBe(false);
      });
    });
  });

  describe("given a process that never recorded a file", () => {
    describe("when it cleans up on the way out", () => {
      it("removes nothing, so a daemon that never published cannot delete one that did", () => {
        expect(unlinkIfSameFile(filePath, null)).toBe(false);
        expect(fs.existsSync(filePath)).toBe(true);
      });
    });
  });

  /**
   * A LIVE symlink is the case `stat` gets quietly wrong. `stat` succeeds on
   * it, so the identity recorded is the TARGET's inode — while `unlink(2)`
   * removes the LINK. The guard would then be authorising a removal against an
   * inode the removal does not touch, which is wrong in both directions: two
   * different links to one target compare equal, and one link repointed between
   * the identify and the unlink compares unequal.
   */
  describe("given a live symlink standing where the socket should be", () => {
    let target: string;
    let link: string;

    beforeEach(() => {
      target = path.join(dir, "target");
      fs.writeFileSync(target, "target");
      link = path.join(dir, "live.sock");
      fs.symlinkSync(target, link);
    });

    describe("when the recorded identity is the target's, as `stat` would report it", () => {
      it("declines, because that is not the file the unlink would remove", () => {
        expect(unlinkIfSameFile(link, identify(target))).toBe(false);
        expect(fs.lstatSync(link).isSymbolicLink()).toBe(true);
      });
    });

    describe("when the recorded identity is the link's own", () => {
      it("removes the link and leaves its target alone, which is what unlink(2) does", () => {
        expect(unlinkIfSameFile(link, identify(link))).toBe(true);

        expect(fs.lstatSync(link, { throwIfNoEntry: false })).toBeUndefined();
        expect(fs.readFileSync(target, "utf8")).toBe("target");
      });
    });
  });
});

describe("stagingSocketPath", () => {
  const shared = "/run/user/501/langwatch-501/0123456789abcdef.sock";

  describe("given the shared socket path", () => {
    describe("when a daemon derives the name it will bind", () => {
      it("stays in the same directory, so publishing is a same-filesystem link", () => {
        expect(path.dirname(stagingSocketPath(shared, 4242))).toBe(
          path.dirname(shared),
        );
      });

      it("stays within the sockaddr_un budget the shared path was sized against", () => {
        // The staging path is the one handed to bind(), so it — not the shared
        // path — is what has to fit. Worst case is the longest pid a platform
        // can issue (7 digits on Linux) standing in for `.sock`.
        //
        // Asserted against the CONSTANT, not a literal 3: that constant is the
        // allowance `daemonSocketDir` and `isDaemonSocketPathUsable` reserve, so
        // a literal here would keep passing after somebody widened the budget
        // (8-digit pids, say) and left this — the one test that measures the
        // real overhead — checking a number nothing else uses any more.
        const widest = stagingSocketPath(shared, 4194304);

        expect(
          Buffer.byteLength(widest, "utf8") - Buffer.byteLength(shared, "utf8"),
        ).toBeLessThanOrEqual(MAX_STAGING_OVERHEAD_BYTES);
      });
    });

    describe("when two daemons race to start", () => {
      it("gives them different files to bind", () => {
        expect(stagingSocketPath(shared, 101)).not.toBe(
          stagingSocketPath(shared, 102),
        );
        expect(stagingSocketPath(shared, 101)).not.toBe(shared);
      });
    });
  });

  describe("given a socket path that does not end in .sock", () => {
    describe("when a daemon derives the name it will bind", () => {
      it("still produces a distinct path rather than colliding with it", () => {
        const odd = "/tmp/langwatch-501/socket";

        expect(stagingSocketPath(odd, 7)).not.toBe(odd);
        expect(path.dirname(stagingSocketPath(odd, 7))).toBe(path.dirname(odd));
      });
    });
  });
});

describe("publishSocket", () => {
  let dir: string;
  let stagingPath: string;
  let socketPath: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "lw-publish-"));
    socketPath = path.join(dir, "identity.sock");
    stagingPath = stagingSocketPath(socketPath, 4242);
    // A regular file stands in for the bound socket: link(), rename() and the
    // (dev, ino) identity behave identically on both, and the file type plays
    // no part in the decision under test.
    fs.writeFileSync(stagingPath, "mine");
  });

  afterEach(() => {
    refuseLink.code = null;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  describe("given the shared name is free", () => {
    describe("when a daemon publishes the socket it bound", () => {
      it("gives that same file the shared name and drops the private one", () => {
        const mine = identify(stagingPath);

        publishSocket(stagingPath, socketPath);

        expect(identify(socketPath)).toEqual(mine);
        expect(fs.existsSync(stagingPath)).toBe(false);
      });
    });
  });

  describe("given another daemon published first", () => {
    describe("when link reports the shared name is taken", () => {
      it("loses politely instead of replacing the winner", () => {
        fs.writeFileSync(socketPath, "theirs");
        const theirs = identify(socketPath);

        expect(() => publishSocket(stagingPath, socketPath)).toThrow(
          DaemonAlreadyRunningError,
        );

        expect(identify(socketPath)).toEqual(theirs);
        expect(fs.readFileSync(socketPath, "utf8")).toBe("theirs");
      });
    });
  });

  describe("given a filesystem that refuses to hard-link the socket", () => {
    beforeEach(() => {
      // EPERM/EOPNOTSUPP here is not a race — it is every start on this
      // filesystem, which is why the rename fallback cannot be unconditional.
      refuseLink.code = "EPERM";
    });

    describe("when the shared name is free", () => {
      it("falls back to an atomic rename so the daemon still starts", () => {
        const mine = identify(stagingPath);

        publishSocket(stagingPath, socketPath);

        expect(identify(socketPath)).toEqual(mine);
        expect(fs.existsSync(stagingPath)).toBe(false);
      });
    });

    describe("when another daemon already holds the shared name", () => {
      it("refuses to rename over it, leaving the winner reachable", () => {
        fs.writeFileSync(socketPath, "theirs");
        const theirs = identify(socketPath);

        expect(() => publishSocket(stagingPath, socketPath)).toThrow(
          DaemonAlreadyRunningError,
        );

        // The winner still answers to the shared name. A rename here would
        // have left it running, holding resolved credentials, on an inode no
        // client can dial — and `stop()` would rightly decline to clean it up.
        expect(identify(socketPath)).toEqual(theirs);
        expect(fs.readFileSync(socketPath, "utf8")).toBe("theirs");
        // Ours is still under its private name, where libuv unlinks it when
        // `listen()` closes the handle.
        expect(fs.existsSync(stagingPath)).toBe(true);
      });
    });
  });
});
