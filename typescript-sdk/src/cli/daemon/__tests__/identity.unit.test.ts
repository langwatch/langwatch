import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import * as fs from "node:fs";
import * as net from "node:net";
import * as os from "node:os";
import * as path from "node:path";

import {
  daemonSocketDir,
  ensureSocketDir,
  inspectSocketTrust,
  isSocketPathUsable,
  resolveIdentity,
  secureSocketFile,
  UntrustedSocketDirError,
} from "../identity";

/**
 * Restore IN PLACE. Assigning `process.env = {...}` swaps the real environment
 * object for a plain one, after which native readers (`os.homedir`,
 * `os.tmpdir`) no longer see anything the tests set.
 */
const restoreEnv = (saved: NodeJS.ProcessEnv): void => {
  for (const key of Object.keys(process.env)) {
    if (!(key in saved)) delete process.env[key];
  }
  Object.assign(process.env, saved);
};

describe("resolveIdentity", () => {
  const saved = { ...process.env };

  beforeEach(() => {
    process.env.LANGWATCH_CLI_CONFIG = "/nonexistent/config.json";
    process.env.LANGWATCH_ENDPOINT = "https://app.example.test";
    process.env.LANGWATCH_API_KEY = "sk-identity-a";
  });

  afterEach(() => {
    restoreEnv(saved);
  });

  describe("given the same endpoint and API key", () => {
    it("resolves the same socket for two invocations", () => {
      const first = resolveIdentity(process.env);
      const second = resolveIdentity(process.env);

      expect(first.fingerprint).toBe(second.fingerprint);
      expect(first.socketPath).toBe(second.socketPath);
    });
  });

  describe("given a different API key", () => {
    it("resolves a different socket, so identity B cannot address identity A's daemon", () => {
      const identityA = resolveIdentity(process.env);

      process.env.LANGWATCH_API_KEY = "sk-identity-b";
      const identityB = resolveIdentity(process.env);

      expect(identityB.fingerprint).not.toBe(identityA.fingerprint);
      expect(identityB.socketPath).not.toBe(identityA.socketPath);
    });
  });

  describe("given a different endpoint", () => {
    it("resolves a different socket", () => {
      const cloud = resolveIdentity(process.env);

      process.env.LANGWATCH_ENDPOINT = "https://self-hosted.example.test";
      const selfHosted = resolveIdentity(process.env);

      expect(selfHosted.fingerprint).not.toBe(cloud.fingerprint);
    });
  });

  describe("given no API key at all", () => {
    it("still resolves an identity, distinct from any keyed one", () => {
      const keyed = resolveIdentity(process.env);

      delete process.env.LANGWATCH_API_KEY;
      const anonymous = resolveIdentity(process.env);

      expect(anonymous.fingerprint).not.toBe(keyed.fingerprint);
      expect(anonymous.socketPath).toMatch(/\.sock$/);
    });
  });

  describe("when the socket path is derived", () => {
    it("does not put the API key anywhere in the path", () => {
      const identity = resolveIdentity(process.env);
      expect(identity.socketPath).not.toContain("sk-identity-a");
    });

    it("fits inside sockaddr_un on this platform", () => {
      const identity = resolveIdentity(process.env);
      expect(isSocketPathUsable(identity.socketPath)).toBe(true);
    });
  });
});

describe("daemonSocketDir", () => {
  const saved = { ...process.env };

  afterEach(() => {
    restoreEnv(saved);
  });

  describe("when XDG_RUNTIME_DIR is set", () => {
    it("uses it", () => {
      process.env.XDG_RUNTIME_DIR = "/run/user/1000";
      delete process.env.LANGWATCH_DAEMON_DIR;

      expect(daemonSocketDir()).toMatch(/^\/run\/user\/1000\/langwatch-\d+$/);
    });
  });

  describe("when XDG_RUNTIME_DIR is absent", () => {
    it("falls back to a directory under HOME, namespaced by uid", () => {
      delete process.env.XDG_RUNTIME_DIR;
      delete process.env.LANGWATCH_DAEMON_DIR;

      const dir = daemonSocketDir();

      // NOT the OS temp dir: on Linux that is /tmp, mode 1777, so another user
      // can pre-create langwatch-<uid>, own it, and leave us unable to secure
      // the socket. Nobody but us can create a directory under $HOME.
      expect(dir).toBe(
        path.join(os.homedir(), ".langwatch", "run", path.basename(dir)),
      );
      expect(path.basename(dir)).toMatch(/^langwatch-\d+$/);
    });

    it("still uses the temp dir when HOME is too long for a unix socket", () => {
      delete process.env.XDG_RUNTIME_DIR;
      delete process.env.LANGWATCH_DAEMON_DIR;
      process.env.HOME = "/" + "h".repeat(90);

      // A daemon in a directory we validate on every connect beats a socket
      // path that overflows sockaddr_un and disables the daemon outright.
      const dir = daemonSocketDir();
      expect(dir.startsWith(os.tmpdir())).toBe(true);
      expect(path.basename(dir)).toMatch(/^langwatch-\d+$/);
    });
  });

  describe("when the caller overrides the directory", () => {
    it("honours LANGWATCH_DAEMON_DIR", () => {
      process.env.LANGWATCH_DAEMON_DIR = "/tmp/custom-daemon-dir";
      expect(daemonSocketDir()).toBe("/tmp/custom-daemon-dir");
    });
  });
});

describe("socket permissions", () => {
  let dir: string;

  beforeEach(() => {
    dir = path.join(
      fs.mkdtempSync(path.join(os.tmpdir(), "lw-daemon-perm-")),
      "sockets",
    );
  });

  afterEach(() => {
    fs.rmSync(path.dirname(dir), { recursive: true, force: true });
  });

  describe("when the socket directory is created", () => {
    it("is 0700, so no other user can even enter it", () => {
      ensureSocketDir(dir);

      const mode = fs.statSync(dir).mode & 0o777;
      expect(mode.toString(8)).toBe("700");
    });

    it("repairs a pre-existing directory with loose permissions", () => {
      fs.mkdirSync(dir, { recursive: true, mode: 0o755 });
      fs.chmodSync(dir, 0o777);

      ensureSocketDir(dir);

      expect((fs.statSync(dir).mode & 0o777).toString(8)).toBe("700");
    });
  });

  describe("when a bound socket is secured", () => {
    it("is 0600, so no other user can connect to a credential-holding daemon", () => {
      ensureSocketDir(dir);
      const socketPath = path.join(dir, "test.sock");
      fs.writeFileSync(socketPath, "");
      fs.chmodSync(socketPath, 0o777);

      secureSocketFile(socketPath);

      expect((fs.statSync(socketPath).mode & 0o777).toString(8)).toBe("600");
    });
  });
});

/**
 * The client-side half of the trust model. Server-side chmod only makes OUR
 * socket private; it says nothing about a socket somebody else bound first.
 */
describe("inspectSocketTrust", () => {
  let dir: string;
  let socketPath: string;
  let listener: net.Server | undefined;

  /** Bind a real unix socket, secured exactly as a real daemon secures its own. */
  const bindSocket = async (): Promise<void> => {
    listener = net.createServer();
    await new Promise<void>((resolve) => listener!.listen(socketPath, resolve));
    secureSocketFile(socketPath);
  };

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "lw-trust-"));
    fs.chmodSync(dir, 0o700);
    socketPath = path.join(dir, "d.sock");
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    if (listener) {
      await new Promise<void>((resolve) => listener!.close(() => resolve()));
      listener = undefined;
    }
    fs.rmSync(dir, { recursive: true, force: true });
  });

  describe("given our own daemon's socket", () => {
    it("trusts a 0600 socket inside a 0700 directory we own", async () => {
      await bindSocket();

      expect(inspectSocketTrust(socketPath)).toBeNull();
    });
  });

  describe("given a socket owned by another user", () => {
    it("refuses it, so we never hand our args and API key to a stranger", async () => {
      await bindSocket();
      // We cannot chown without root; moving OUR uid is the same comparison.
      vi.spyOn(process, "getuid").mockReturnValue(
        (process.getuid?.() ?? 0) + 1,
      );

      expect(inspectSocketTrust(socketPath)).toBe("socket-dir-foreign-owner");
    });
  });

  describe("given a directory another user can write", () => {
    it("refuses it, because they could unlink our socket and bind their own", async () => {
      await bindSocket();
      fs.chmodSync(dir, 0o777);

      expect(inspectSocketTrust(socketPath)).toBe("socket-dir-loose-mode");
    });
  });

  describe("given a socket other users can connect to", () => {
    it("refuses it rather than driving a daemon anyone can also drive", async () => {
      await bindSocket();
      fs.chmodSync(socketPath, 0o666);

      expect(inspectSocketTrust(socketPath)).toBe("socket-loose-mode");
    });
  });

  describe("given a symlink standing in for the socket", () => {
    it("refuses it rather than following it somewhere we did not choose", async () => {
      const elsewhere = path.join(dir, "real.sock");
      listener = net.createServer();
      await new Promise<void>((resolve) => listener!.listen(elsewhere, resolve));
      secureSocketFile(elsewhere);
      fs.symlinkSync(elsewhere, socketPath);

      expect(inspectSocketTrust(socketPath)).toBe("socket-not-a-socket");
    });
  });

  describe("given a regular file where the socket should be", () => {
    it("refuses it", () => {
      fs.writeFileSync(socketPath, "corpse", { mode: 0o600 });

      expect(inspectSocketTrust(socketPath)).toBe("socket-not-a-socket");
    });
  });

  describe("given nothing is listening at all", () => {
    it("reports the ordinary no-daemon case", () => {
      expect(inspectSocketTrust(socketPath)).toBe("socket-missing");
    });

    it("reports a missing directory rather than throwing", () => {
      expect(inspectSocketTrust(path.join(dir, "gone", "d.sock"))).toBe(
        "socket-dir-missing",
      );
    });
  });
});

describe("ensureSocketDir", () => {
  let root: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "lw-ensure-"));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(root, { recursive: true, force: true });
  });

  describe("given a directory pre-created by another user", () => {
    it("fails closed instead of continuing with a socket it cannot make private", () => {
      const squatted = path.join(root, "langwatch-501");
      fs.mkdirSync(squatted, { mode: 0o777 });
      vi.spyOn(process, "getuid").mockReturnValue(
        (process.getuid?.() ?? 0) + 1,
      );

      expect(() => ensureSocketDir(squatted)).toThrow(UntrustedSocketDirError);
    });
  });

  describe("given a symlink where the socket directory should be", () => {
    it("refuses it rather than trusting whatever it points at", () => {
      const target = path.join(root, "target");
      fs.mkdirSync(target, { mode: 0o700 });
      const link = path.join(root, "link");
      fs.symlinkSync(target, link);

      expect(() => ensureSocketDir(link)).toThrow(UntrustedSocketDirError);
    });
  });
});

describe("isSocketPathUsable", () => {
  describe("given a path longer than sockaddr_un allows", () => {
    it("rejects it, so the client falls back instead of crashing at bind()", () => {
      expect(isSocketPathUsable("/tmp/" + "x".repeat(120) + ".sock")).toBe(
        false,
      );
    });
  });
});
