/**
 * The ops agent's local state: PKCE, private files and session expiry.
 * @see modules/staff-access/specs/staff-access-cli.feature
 */
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  createPkcePair,
  forgetPendingRequest,
  loadRequesterKey,
  type OpsSession,
  opsAgentPath,
  opsPendingPath,
  opsSessionPath,
  pickSessionProject,
  pkceChallengeFor,
  readOpsSession,
  saveOpsSession,
  saveRequesterKey,
  storePendingRequest,
  takePendingRequest,
} from "../opsSession";

const modeOf = (file: string): number => fs.statSync(file).mode & 0o777;

const session = (extra: Partial<OpsSession> = {}): OpsSession => ({
  version: 1,
  endpoint: "https://app.langwatch.test",
  requestId: "req_1",
  apiKey: "sk-lw-staffLookup_secret",
  organizationId: "org_acme",
  projects: [
    { id: "proj_a", slug: "alpha", name: "Alpha" },
    { id: "proj_b", slug: "beta", name: "Beta" },
  ],
  defaultProjectId: "proj_b",
  scopes: ["org:content"],
  expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
  createdAt: new Date().toISOString(),
  ...extra,
});

describe("ops agent local state", () => {
  let home: string;
  let saved: { config?: string; session?: string };

  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), "lw-ops-unit-"));
    saved = {
      config: process.env.LANGWATCH_CLI_CONFIG,
      session: process.env.LANGWATCH_OPS_SESSION,
    };
    process.env.LANGWATCH_CLI_CONFIG = path.join(home, "cfg", "config.json");
    delete process.env.LANGWATCH_OPS_SESSION;
  });

  afterEach(() => {
    if (saved.config === undefined) delete process.env.LANGWATCH_CLI_CONFIG;
    else process.env.LANGWATCH_CLI_CONFIG = saved.config;
    if (saved.session === undefined) delete process.env.LANGWATCH_OPS_SESSION;
    else process.env.LANGWATCH_OPS_SESSION = saved.session;
    fs.rmSync(home, { recursive: true, force: true });
  });

  describe("when creating a PKCE pair", () => {
    it("derives the RFC 7636 S256 challenge", () => {
      expect(
        pkceChallengeFor({ codeVerifier: "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk" }),
      ).toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
    });

    it("draws a fresh 32-byte base64url verifier each time", () => {
      const first = createPkcePair();
      const second = createPkcePair();
      expect(first.codeVerifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(Buffer.from(first.codeVerifier, "base64url")).toHaveLength(32);
      expect(first.codeVerifier).not.toBe(second.codeVerifier);
      expect(first.codeChallenge).toBe(
        crypto.createHash("sha256").update(first.codeVerifier).digest("base64url"),
      );
    });
  });

  describe("when writing the private files", () => {
    it("stores the requester key beside the config with mode 0600 in a 0700 directory", () => {
      const file = saveRequesterKey({ requesterKey: "lwsr_abc_def" });
      expect(file).toBe(path.join(home, "cfg", "ops-agent.json"));
      expect(file).toBe(opsAgentPath());
      expect(modeOf(file)).toBe(0o600);
      expect(modeOf(path.dirname(file))).toBe(0o700);
      expect(loadRequesterKey()).toBe("lwsr_abc_def");
    });

    it("writes the session file with mode 0600 and leaves no temp file behind", () => {
      const file = saveOpsSession(session());
      expect(file).toBe(path.join(home, "cfg", "ops-session.json"));
      expect(modeOf(file)).toBe(0o600);
      expect(fs.readdirSync(path.dirname(file))).toEqual(["ops-session.json"]);
    });

    it("honours LANGWATCH_OPS_SESSION for the session and its pending verifiers", () => {
      process.env.LANGWATCH_OPS_SESSION = path.join(home, "elsewhere", "s.json");
      const file = saveOpsSession(session());
      expect(file).toBe(opsSessionPath());
      expect(file).toBe(path.join(home, "elsewhere", "s.json"));
      expect(opsPendingPath()).toBe(path.join(home, "elsewhere", "ops-pending.json"));
      expect(modeOf(file)).toBe(0o600);
    });
  });

  describe("when reading the session back", () => {
    it("reads a session before its expiry as live", () => {
      saveOpsSession(session());
      expect(readOpsSession().kind).toBe("live");
    });

    it("reads a session past its expiry as expired", () => {
      saveOpsSession(session({ expiresAt: new Date(Date.now() - 1_000).toISOString() }));
      expect(readOpsSession().kind).toBe("expired");
    });

    it("reads no file as none and a corrupt file as invalid", () => {
      expect(readOpsSession().kind).toBe("none");
      fs.mkdirSync(path.dirname(opsSessionPath()), { recursive: true });
      fs.writeFileSync(opsSessionPath(), "{not json");
      expect(readOpsSession().kind).toBe("invalid");
    });
  });

  describe("when choosing the session project", () => {
    it("uses the stored default, and a selector by id or slug", () => {
      expect(pickSessionProject({ session: session() })?.id).toBe("proj_b");
      expect(pickSessionProject({ session: session(), selector: "alpha" })?.id).toBe("proj_a");
      expect(pickSessionProject({ session: session(), selector: "proj_a" })?.id).toBe("proj_a");
      expect(pickSessionProject({ session: session(), selector: "gamma" })).toBeUndefined();
    });
  });

  describe("when a request waits to be redeemed", () => {
    it("keeps a verifier until it is redeemed, in a 0600 file", () => {
      const expiresAt = new Date(Date.now() + 600_000).toISOString();
      storePendingRequest({
        requestId: "req_9",
        pending: { endpoint: "https://x.test", codeVerifier: "v", approvalUrl: "u", expiresAt },
      });
      expect(modeOf(opsPendingPath())).toBe(0o600);
      expect(takePendingRequest({ requestId: "req_9" })?.codeVerifier).toBe("v");
      forgetPendingRequest({ requestId: "req_9" });
      expect(takePendingRequest({ requestId: "req_9" })).toBeUndefined();
      expect(fs.existsSync(opsPendingPath())).toBe(false);
    });

    it("drops a verifier whose approval window closed", () => {
      storePendingRequest({
        requestId: "req_old",
        pending: {
          endpoint: "https://x.test",
          codeVerifier: "v",
          approvalUrl: "u",
          expiresAt: new Date(Date.now() - 1).toISOString(),
        },
      });
      expect(takePendingRequest({ requestId: "req_old" })).toBeUndefined();
    });
  });
});
