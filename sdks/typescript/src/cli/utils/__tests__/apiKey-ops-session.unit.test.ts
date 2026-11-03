/**
 * Credential precedence with an ops session: flag > live ops session > env > device session.
 * @see modules/staff-access/specs/staff-access-cli.feature
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("dotenv", () => ({ config: vi.fn(() => ({ parsed: {} })) }));
vi.mock("../identityNotice", () => ({
  maybePrintIdentityNotice: vi.fn(async () => undefined),
}));

import { runWithCredentialHolder, scopedProjectId } from "../../../internal/credentialContext";
import { resolveCredentials } from "../apiKey";
import { type OpsSession, opsSessionPath, saveOpsSession } from "../opsSession";

const ENDPOINT = "https://app.langwatch.test";
const STAFF_KEY = "sk-lw-staffLookup_staffsecret";

const session = (extra: Partial<OpsSession> = {}): OpsSession => ({
  version: 1,
  endpoint: ENDPOINT,
  requestId: "req_1",
  apiKey: STAFF_KEY,
  organizationId: "org_acme",
  projects: [
    { id: "proj_a", slug: "alpha", name: "Alpha" },
    { id: "proj_b", slug: "beta", name: "Beta" },
  ],
  defaultProjectId: "proj_a",
  scopes: ["org:content"],
  expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
  createdAt: new Date().toISOString(),
  ...extra,
});

describe("resolveCredentials() with an ops session", () => {
  let home: string;
  let saved: Record<string, string | undefined>;
  let errorSpy: { mock: { calls: unknown[][] } };
  const names = [
    "LANGWATCH_CLI_CONFIG",
    "LANGWATCH_OPS_SESSION",
    "LANGWATCH_API_KEY",
    "LANGWATCH_ENDPOINT",
    "LANGWATCH_PROJECT_ID",
  ];

  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), "lw-ops-cred-"));
    saved = Object.fromEntries(names.map((name) => [name, process.env[name]]));
    for (const name of names) delete process.env[name];
    process.env.LANGWATCH_CLI_CONFIG = path.join(home, "config.json");
    process.env.LANGWATCH_ENDPOINT = ENDPOINT;
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(process, "exit").mockImplementation((() => {
      throw new Error("process.exit called");
    }) as never);
  });

  afterEach(() => {
    for (const name of names) {
      if (saved[name] === undefined) delete process.env[name];
      else process.env[name] = saved[name];
    }
    fs.rmSync(home, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  const resolve = (opts: { apiKey?: string; project?: string } = {}) =>
    runWithCredentialHolder(async () => {
      const resolved = await resolveCredentials(opts);
      return { resolved, projectId: scopedProjectId() };
    });

  it("lets an explicit --api-key beat the ops session", async () => {
    saveOpsSession(session());
    const { resolved } = await resolve({ apiKey: "sk-explicit" });
    expect(resolved.source).toBe("flag");
  });

  it("uses a live ops session over LANGWATCH_API_KEY, on the session's default project", async () => {
    saveOpsSession(session());
    process.env.LANGWATCH_API_KEY = "sk-from-env";
    process.env.LANGWATCH_PROJECT_ID = "proj_from_folder";
    const { resolved, projectId } = await resolve();
    expect(resolved.source).toBe("ops-session");
    expect(resolved.apiKey).toBe(STAFF_KEY);
    expect(projectId).toBe("proj_a");
  });

  it("picks the session project --project names by slug", async () => {
    saveOpsSession(session());
    const { resolved, projectId } = await resolve({ project: "beta" });
    expect(resolved.projectId).toBe("proj_b");
    expect(projectId).toBe("proj_b");
  });

  it("refuses a --project the session does not cover", async () => {
    saveOpsSession(session());
    await expect(resolve({ project: "gamma" })).rejects.toThrow("process.exit called");
  });

  it("ignores an expired session with a one-line notice and removes it", async () => {
    saveOpsSession(session({ expiresAt: new Date(Date.now() - 1_000).toISOString() }));
    process.env.LANGWATCH_API_KEY = "sk-from-env";
    const { resolved } = await resolve();
    expect(resolved.source).toBe("env");
    const notices = errorSpy.mock.calls.map((call: unknown[]) => String(call[0]));
    expect(notices.filter((line: string) => line.includes("expired"))).toHaveLength(1);
    expect(fs.existsSync(opsSessionPath())).toBe(false);
  });

  it("never sends the session key to another endpoint", async () => {
    saveOpsSession(session({ endpoint: "https://other.example" }));
    process.env.LANGWATCH_API_KEY = "sk-from-env";
    const { resolved } = await resolve();
    expect(resolved.source).toBe("env");
  });

  it("falls through when the session holds only an ops token", async () => {
    saveOpsSession(session({ apiKey: undefined, opsToken: "lwsa_x", scopes: ["ops:read"] }));
    process.env.LANGWATCH_API_KEY = "sk-from-env";
    const { resolved } = await resolve();
    expect(resolved.source).toBe("env");
  });
});
