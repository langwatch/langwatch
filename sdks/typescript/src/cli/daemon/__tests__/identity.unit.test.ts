import { describe, expect, it, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import {
  daemonSocketDir,
  ensureSocketDir,
  isSocketPathUsable,
  resolveIdentity,
  secureSocketFile,
} from "../identity";

describe("resolveIdentity", () => {
  const saved = { ...process.env };

  beforeEach(() => {
    process.env.LANGWATCH_CLI_CONFIG = "/nonexistent/config.json";
    process.env.LANGWATCH_ENDPOINT = "https://app.example.test";
    process.env.LANGWATCH_API_KEY = "sk-identity-a";
  });

  afterEach(() => {
    process.env = { ...saved };
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
    process.env = { ...saved };
  });

  describe("when XDG_RUNTIME_DIR is set", () => {
    it("uses it", () => {
      process.env.XDG_RUNTIME_DIR = "/run/user/1000";
      delete process.env.LANGWATCH_DAEMON_DIR;

      expect(daemonSocketDir()).toMatch(/^\/run\/user\/1000\/langwatch-\d+$/);
    });
  });

  describe("when XDG_RUNTIME_DIR is absent", () => {
    it("falls back to the OS temp dir, namespaced by uid", () => {
      delete process.env.XDG_RUNTIME_DIR;
      delete process.env.LANGWATCH_DAEMON_DIR;

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

describe("isSocketPathUsable", () => {
  describe("given a path longer than sockaddr_un allows", () => {
    it("rejects it, so the client falls back instead of crashing at bind()", () => {
      expect(isSocketPathUsable("/tmp/" + "x".repeat(120) + ".sock")).toBe(
        false,
      );
    });
  });
});
