/**
 * The ops agent's staff access, end to end against the REAL built CLI and a local HTTP server
 * faking the staff-access routes: setup from stdin, request, wait, redeem, a private session file,
 * normal commands on the session key only with --ops-session, expiry and early end.
 * @see modules/staff-access/specs/staff-access-cli.feature
 */
import { spawn } from "node:child_process";
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as http from "node:http";
import type { AddressInfo } from "node:net";
import * as os from "node:os";
import * as path from "node:path";

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

const CLI_PATH = path.resolve(__dirname, "../../../../dist/cli/index.js");

const REQUESTER_KEY = "lwsr_lookup01_requestersecret";
const STAFF_KEY = "sk-lw-staffLookup01_staffsecret";
const PROJECT = { id: "proj_acme_support", slug: "acme-support", name: "ACME Support" };

interface RunResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
}

let server: http.Server;
let endpoint = "";
let stateDir: string;
let workDir: string;
let codeChallenge = "";
let statusPolls = 0;
let failedPolls = 0;
let requestBody: Record<string, unknown> = {};
let redeemCalls = 0;
let endCalls = 0;
let searchAuth: string | null = null;
const OPS_TOKEN = "lwsa_opsread01_secret";

const sessionFile = () => path.join(stateDir, "ops-session.json");

const run = (
  args: string[],
  env: Record<string, string> = {},
  { input }: { input?: string } = {},
): Promise<RunResult> =>
  new Promise((resolve) => {
    const baseEnv: Record<string, string | undefined> = { ...process.env };
    for (const name of [
      "LANGWATCH_API_KEY",
      "LANGWATCH_PROJECT_ID",
      "LANGWATCH_OPS_SESSION",
      "LANGWATCH_OPS_REQUESTER_KEY",
      "CLAUDECODE",
      "CLAUDE_CODE",
      "CURSOR_AGENT",
      "GITHUB_COPILOT",
      "AMAZON_Q",
      "LW_AGENT_MODE",
      "LANGWATCH_AGENT_MODE",
    ]) {
      delete baseEnv[name];
    }
    const child = spawn(process.execPath, [CLI_PATH, ...args], {
      cwd: workDir,
      stdio: ["pipe", "pipe", "pipe"],
      env: {
        ...baseEnv,
        LANGWATCH_ENDPOINT: endpoint,
        LANGWATCH_CLI_CONFIG: path.join(stateDir, "config.json"),
        LANGWATCH_NO_DAEMON: "1",
        LANGWATCH_DAEMON_NO_SPAWN: "1",
        ...env,
      },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString()));
    child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
    child.stdin.end(input ?? "");
    child.on("close", (exitCode) => resolve({ stdout, stderr, exitCode }));
  });

const writeSession = (extra: Record<string, unknown> = {}) => {
  fs.writeFileSync(
    sessionFile(),
    JSON.stringify({
      version: 1,
      endpoint,
      requestId: "req_live",
      apiKey: STAFF_KEY,
      organizationId: "org_acme",
      projects: [PROJECT],
      defaultProjectId: PROJECT.id,
      scopes: ["org:content"],
      expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
      createdAt: new Date().toISOString(),
      ...extra,
    }),
    { mode: 0o600 },
  );
};

type Reply = { status: number; payload: unknown };

/** The staff-access routes the requester key opens, keyed by `METHOD path`. */
const staffRoutes: Record<string, (body: string) => Reply> = {
  "POST /api/staff-access/requests": (body) => {
    requestBody = JSON.parse(body) as Record<string, unknown>;
    codeChallenge = String(requestBody.codeChallenge);
    return {
      status: 201,
      payload: {
        requestId: "req_1",
        approvalUrl: `${endpoint}/ops/agents/approve/req_1`,
        expiresAt: new Date(Date.now() + 600_000).toISOString(),
      },
    };
  },
  "GET /api/staff-access/requests/req_1": () => {
    statusPolls++;
    if (statusPolls <= failedPolls) {
      return { status: 503, payload: { error: "main thread did not answer" } };
    }
    return {
      status: 200,
      payload: { status: statusPolls > failedPolls + 1 ? "approved" : "pending" },
    };
  },
  "POST /api/staff-access/requests/req_1/redeem": (body) => {
    redeemCalls++;
    const { codeVerifier } = JSON.parse(body) as { codeVerifier: string };
    const derived = crypto.createHash("sha256").update(codeVerifier).digest("base64url");
    if (derived !== codeChallenge) {
      return { status: 400, payload: { error: { code: "invalid_code_verifier" } } };
    }
    return {
      status: 200,
      payload: {
        apiKey: STAFF_KEY,
        organizationId: "org_acme",
        projects: [PROJECT],
        scopes: ["org:content"],
        expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
      },
    };
  },
  "POST /api/staff-access/requests/req_live/end": () => {
    endCalls++;
    return { status: 200, payload: { status: "revoked" } };
  },
};

const route = ({ req, body }: { req: http.IncomingMessage; body: string }): Reply => {
  const url = req.url ?? "";
  const auth = req.headers.authorization ?? "";
  if (url.startsWith("/api/staff-access/ops/organizations")) {
    if (auth !== `Bearer ${OPS_TOKEN}`) return { status: 401, payload: { error: "unauthorized" } };
    return {
      status: 200,
      payload: { organizations: [{ id: "org_acme", slug: "acme", name: "ACME" }] },
    };
  }
  if (url.startsWith("/api/v1/traces/search")) {
    searchAuth = auth;
    return { status: 200, payload: { traces: [], pagination: { totalHits: 0 } } };
  }
  const key = `${req.method} ${url}`;
  const handler = Object.hasOwn(staffRoutes, key) ? staffRoutes[key] : undefined;
  if (typeof handler !== "function") return { status: 404, payload: { error: "not_found" } };
  if (auth !== `Bearer ${REQUESTER_KEY}`)
    return { status: 401, payload: { error: "unauthorized" } };
  return handler(body);
};

beforeAll(async () => {
  server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (chunk: Buffer) => (body += chunk.toString()));
    req.on("end", () => {
      const { status, payload } = route({ req, body });
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(payload));
    });
  });
  await new Promise<void>((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
  endpoint = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}, 30_000);

afterAll(async () => {
  await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
});

beforeEach(() => {
  stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "lw-ops-state-"));
  workDir = fs.mkdtempSync(path.join(os.tmpdir(), "lw-ops-work-"));
  codeChallenge = "";
  statusPolls = 0;
  failedPolls = 0;
  requestBody = {};
  redeemCalls = 0;
  endCalls = 0;
  searchAuth = null;
});

afterEach(() => {
  fs.rmSync(stateDir, { recursive: true, force: true });
  fs.rmSync(workDir, { recursive: true, force: true });
});

const basicFor = (projectId: string) =>
  `Basic ${Buffer.from(`${projectId}:${STAFF_KEY}`, "utf-8").toString("base64")}`;

describe("langwatch ops access", () => {
  /** @scenario "The CLI requests, waits for approval and stores the key in a private session file" */
  it("requests, waits for approval and stores the key in a private session file", async () => {
    const setup = await run(["ops", "setup"], {}, { input: `${REQUESTER_KEY}\n` });
    expect(setup.exitCode).toBe(0);
    expect(setup.stdout + setup.stderr).not.toContain(REQUESTER_KEY);
    expect(fs.statSync(path.join(stateDir, "ops-agent.json")).mode & 0o777).toBe(0o600);

    const result = await run([
      "ops",
      "access",
      "request",
      "--scope",
      "org:content",
      "--org",
      "acme",
      "--reason",
      "ACME reports missing traces since Monday",
      "-o",
      "json",
    ]);

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toContain(`${endpoint}/ops/agents/approve/req_1`);
    expect(statusPolls).toBeGreaterThanOrEqual(2);
    expect(redeemCalls).toBe(1);
    expect(requestBody).toMatchObject({
      scopes: ["org:content"],
      organization: "acme",
      codeChallengeMethod: "S256",
    });
    expect(String(requestBody.machine)).toContain(os.hostname());

    const output = JSON.parse(result.stdout) as Record<string, unknown>;
    expect(output.status).toBe("redeemed");
    expect(result.stdout).not.toContain(STAFF_KEY);

    expect(fs.statSync(sessionFile()).mode & 0o777).toBe(0o600);
    const stored = JSON.parse(fs.readFileSync(sessionFile(), "utf8")) as Record<string, unknown>;
    expect(stored).toMatchObject({
      apiKey: STAFF_KEY,
      requestId: "req_1",
      endpoint,
      defaultProjectId: PROJECT.id,
    });
    expect(fs.existsSync(path.join(workDir, ".env"))).toBe(false);
    expect(fs.existsSync(path.join(stateDir, "ops-pending.json"))).toBe(false);
  }, 30_000);

  /** @scenario "The CLI keeps waiting through a status read the server failed to answer" */
  it("keeps waiting through a failed status read and redeems once approved", async () => {
    failedPolls = 1;
    await run(["ops", "setup"], {}, { input: `${REQUESTER_KEY}\n` });

    const result = await run([
      "ops",
      "access",
      "request",
      "--scope",
      "org:content",
      "--org",
      "acme",
      "--reason",
      "ACME reports missing traces since Monday",
      "-o",
      "json",
    ]);

    expect(result.exitCode).toBe(0);
    expect(statusPolls).toBeGreaterThanOrEqual(3);
    expect(redeemCalls).toBe(1);
  }, 30_000);

  /** @scenario "Setup reads the requester key from stdin" */
  it("stores the key piped on stdin and refuses an empty stdin", async () => {
    const empty = await run(["ops", "setup"], {}, { input: "" });
    expect(empty.exitCode).not.toBe(0);
    expect(empty.stderr).toContain("pbpaste | langwatch ops setup");
    expect(fs.existsSync(path.join(stateDir, "ops-agent.json"))).toBe(false);

    const piped = await run(["ops", "setup"], {}, { input: `  ${REQUESTER_KEY}\n` });
    expect(piped.exitCode).toBe(0);
    const stored = JSON.parse(
      fs.readFileSync(path.join(stateDir, "ops-agent.json"), "utf8"),
    ) as Record<string, unknown>;
    expect(stored.requesterKey).toBe(REQUESTER_KEY);
  }, 30_000);

  /** @scenario "The requester key is never taken as an argument" */
  it("refuses the old --requester-key flag", async () => {
    const result = await run(["ops", "setup", "--requester-key", REQUESTER_KEY]);
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("unknown option '--requester-key'");
    expect(fs.existsSync(path.join(stateDir, "ops-agent.json"))).toBe(false);
  }, 30_000);

  /** @scenario "A normal command ignores a live ops session" */
  it("keeps the folder's own key on a normal command while a session lives", async () => {
    writeSession();
    fs.writeFileSync(path.join(workDir, ".env"), "LANGWATCH_API_KEY=sk-lw-folderkey\n");

    const result = await run(["trace", "search", "-o", "json"]);

    expect(result.exitCode).toBe(0);
    expect(searchAuth).toContain("sk-lw-folderkey");
    expect(searchAuth).not.toContain(STAFF_KEY);
    expect(result.stderr).toContain("--ops-session");
  }, 30_000);

  /** @scenario "A command run with --ops-session uses the session and says so" */
  it("sends the session's key with --ops-session and prints the identity notice", async () => {
    writeSession();
    fs.writeFileSync(path.join(workDir, ".env"), "LANGWATCH_API_KEY=sk-lw-folderkey\n");

    const result = await run(["trace", "search", "--ops-session", "-o", "json"]);

    expect(result.exitCode).toBe(0);
    expect(searchAuth).toBe(basicFor(PROJECT.id));
    expect(result.stderr).toContain("Using ops session req_live on organization org_acme");
  }, 30_000);

  /** @scenario "An ops command uses the session and says so" */
  it("runs ops orgs on the session's ops token with the notice and the contract's columns", async () => {
    writeSession({ apiKey: undefined, opsToken: OPS_TOKEN, scopes: ["ops:read"] });

    const result = await run(["ops", "orgs"]);

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toContain("Using ops session req_live");
    const header = result.stdout.split("\n").find((line) => line.includes("Slug")) ?? "";
    expect(header.trim().split(/\s+/)).toEqual(["ID", "Slug", "Name"]);
    expect(result.stdout).toContain("ACME");
  }, 30_000);

  /** @scenario "An expired ops session is refused, never replaced by other credentials" */
  it("refuses an expired session asked for with --ops-session and says so", async () => {
    writeSession({ expiresAt: new Date(Date.now() - 60_000).toISOString() });

    const result = await run(["trace", "search", "--ops-session", "-o", "json"], {
      LANGWATCH_API_KEY: "sk-lw-envkey",
    });

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("expired");
    expect(searchAuth).toBeNull();
    expect(fs.existsSync(sessionFile())).toBe(false);
  }, 30_000);

  /** @scenario "The CLI ends a session early" */
  it("revokes the session on the server and removes the file", async () => {
    writeSession();

    const result = await run(["ops", "access", "end", "-o", "json"], {
      LANGWATCH_OPS_REQUESTER_KEY: REQUESTER_KEY,
    });

    expect(result.exitCode).toBe(0);
    expect(endCalls).toBe(1);
    expect(fs.existsSync(sessionFile())).toBe(false);
  }, 30_000);
});
