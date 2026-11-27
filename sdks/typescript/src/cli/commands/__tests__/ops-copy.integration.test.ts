/**
 * `langwatch ops copy` end to end against the REAL built CLI and a local HTTP server faking the
 * staff-access routes: one approval per organization, the copy on the target's ops token with
 * the source's in the body, and both sessions ended afterwards.
 * @see modules/staff-access/specs/staff-access-org-copy.feature
 */
import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as http from "node:http";
import type { AddressInfo } from "node:net";
import * as os from "node:os";
import * as path from "node:path";

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

const CLI_PATH = path.resolve(__dirname, "../../../../dist/cli/index.js");

const REQUESTER_KEY = "lwsr_lookup01_requestersecret";
const OPS_TOKENS: Record<string, string> = {
  req_source: "lwsa_sourcelookup_sourcesecret",
  req_target: "lwsa_targetlookup_targetsecret",
};

interface RunResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
}

let server: http.Server;
let endpoint = "";
let stateDir: string;
let workDir: string;
let requests: Record<string, unknown>[] = [];
let copyCall: { auth: string; body: Record<string, unknown> } | null = null;
let ended: string[] = [];
let endRefused = new Set<string>();
let statusFailures = 0;
let decisions: Record<string, string> = {};
let redeemWithoutToken = false;
let stoppedBecause: string | null = null;

const run = (args: string[]): Promise<RunResult> =>
  new Promise((resolve) => {
    const baseEnv: Record<string, string | undefined> = { ...process.env };
    for (const name of [
      "LANGWATCH_API_KEY",
      "LANGWATCH_PROJECT_ID",
      "LANGWATCH_OPS_SESSION",
      "CLAUDECODE",
      "CLAUDE_CODE",
      "LW_AGENT_MODE",
      "LANGWATCH_AGENT_MODE",
    ]) {
      delete baseEnv[name];
    }
    const child = spawn(process.execPath, [CLI_PATH, ...args], {
      cwd: workDir,
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...baseEnv,
        LANGWATCH_ENDPOINT: endpoint,
        LANGWATCH_CLI_CONFIG: path.join(stateDir, "config.json"),
        LANGWATCH_OPS_REQUESTER_KEY: REQUESTER_KEY,
        LANGWATCH_NO_DAEMON: "1",
        LANGWATCH_DAEMON_NO_SPAWN: "1",
      },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString()));
    child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
    child.on("close", (exitCode) => resolve({ stdout, stderr, exitCode }));
  });

type Reply = { status: number; payload: unknown };

const report = {
  source: { id: "org_acme", slug: "acme", name: "ACME" },
  target: { id: "org_globex", slug: "globex", name: "Globex" },
  dryRun: true,
  items: [
    {
      kind: "project",
      name: "support-bot",
      sourceId: "project_1",
      sourceProjectId: "project_1",
      outcome: "planned",
      targetId: null,
      targetProjectId: null,
      reason: null,
    },
  ],
  totals: { planned: 1, copied: 0, already_copied: 0, skipped: 0, failed: 0 },
};

const requesterRoute = ({ method, url, body }: { method: string; url: string; body: string }) => {
  if (method === "POST" && url === "/api/staff-access/requests") {
    const parsed = JSON.parse(body) as Record<string, unknown>;
    requests.push(parsed);
    const requestId = parsed.organization === "acme" ? "req_source" : "req_target";
    return {
      status: 201,
      payload: {
        requestId,
        approvalUrl: `${endpoint}/ops/agents/approve/${requestId}`,
        expiresAt: new Date(Date.now() + 600_000).toISOString(),
      },
    };
  }
  const match = /^\/api\/staff-access\/requests\/(req_\w+)(\/redeem|\/end)?$/.exec(url);
  const requestId = match?.[1] ?? "";
  if (!match || !OPS_TOKENS[requestId]) return { status: 404, payload: { error: "not_found" } };
  if (match[2] === "/redeem") {
    const opsToken = redeemWithoutToken ? {} : { opsToken: OPS_TOKENS[requestId] };
    return { status: 200, payload: { organizationId: "org", ...opsToken } };
  }
  if (match[2] === "/end") {
    if (endRefused.has(requestId)) return { status: 500, payload: { error: "internal" } };
    ended.push(requestId);
    return { status: 200, payload: { status: "revoked" } };
  }
  if (statusFailures > 0) {
    statusFailures -= 1;
    return { status: 500, payload: { error: "internal" } };
  }
  return { status: 200, payload: { status: decisions[requestId] ?? "approved" } };
};

const route = ({ req, body }: { req: http.IncomingMessage; body: string }): Reply => {
  const url = req.url ?? "";
  const auth = req.headers.authorization ?? "";
  if (req.method === "POST" && url === "/api/staff-access/ops/copies") {
    copyCall = { auth, body: JSON.parse(body) as Record<string, unknown> };
    return { status: 200, payload: stoppedBecause ? { ...report, stoppedBecause } : report };
  }
  if (auth !== `Bearer ${REQUESTER_KEY}`) {
    return { status: 401, payload: { error: "unauthorized" } };
  }
  return requesterRoute({ method: req.method ?? "", url, body });
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
  stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "lw-ops-copy-state-"));
  workDir = fs.mkdtempSync(path.join(os.tmpdir(), "lw-ops-copy-work-"));
  requests = [];
  copyCall = null;
  ended = [];
  endRefused = new Set();
  statusFailures = 0;
  decisions = {};
  redeemWithoutToken = false;
  stoppedBecause = null;
});

afterEach(() => {
  fs.rmSync(stateDir, { recursive: true, force: true });
  fs.rmSync(workDir, { recursive: true, force: true });
});

describe("langwatch ops copy", () => {
  /** @scenario "The CLI asks one approval per organization and runs the copy" */
  it("asks one approval per organization, copies on the target token and ends both", async () => {
    const result = await run(["ops", "copy", "--from", "acme", "--to", "globex", "--dry-run"]);

    expect(result.exitCode).toBe(0);
    expect(requests).toEqual([
      expect.objectContaining({
        scopes: ["copy:source"],
        organization: "acme",
        counterpartOrganization: "globex",
      }),
      expect.objectContaining({
        scopes: ["copy:target"],
        organization: "globex",
        counterpartOrganization: "acme",
      }),
    ]);
    expect(result.stderr).toContain(`${endpoint}/ops/agents/approve/req_source`);
    expect(result.stderr).toContain(`${endpoint}/ops/agents/approve/req_target`);
    expect(copyCall).toEqual({
      auth: `Bearer ${OPS_TOKENS.req_target}`,
      body: { sourceOpsToken: OPS_TOKENS.req_source, dryRun: true },
    });
    expect(ended.toSorted()).toEqual(["req_source", "req_target"]);
    expect(result.stdout).toContain("support-bot");
    expect(result.stdout).not.toContain(OPS_TOKENS.req_source);
    expect(fs.readdirSync(stateDir)).toEqual([]);
  }, 30_000);

  /** @scenario "The CLI says once that it cannot read an approval and keeps waiting" */
  it("warns once about repeated failed status reads and still copies", async () => {
    statusFailures = 2;

    const result = await run(["ops", "copy", "--from", "acme", "--to", "globex", "--dry-run"]);

    expect(result.exitCode).toBe(0);
    expect(result.stderr.match(/Could not read request req_source/g)).toHaveLength(1);
    expect(copyCall).not.toBeNull();
  }, 30_000);

  /** @scenario "The CLI says which copy session it could not end and fails" */
  it("names the session whose end failed, with its cause, and exits non-zero", async () => {
    endRefused = new Set(["req_target"]);

    const result = await run([
      "ops",
      "copy",
      "--from",
      "acme",
      "--to",
      "globex",
      "--dry-run",
      "--format",
      "json",
    ]);

    expect(result.exitCode).not.toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      ok: false,
      error: { code: "copy_sessions_still_live", meta: { requestIds: ["req_target"] } },
    });
    expect(result.stderr).toMatch(/Could not end copy session req_target: \S.*/);
    expect(ended).toEqual(["req_source"]);
  }, 30_000);

  /** @scenario "The CLI refuses a project list that names no project" */
  it("refuses an empty --projects before asking any approval", async () => {
    const result = await run([
      "ops",
      "copy",
      "--from",
      "acme",
      "--to",
      "globex",
      "--projects",
      " , ",
      "--format",
      "json",
    ]);

    expect(result.exitCode).not.toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      ok: false,
      error: { code: "validation_error" },
    });
    expect(requests).toEqual([]);
  }, 30_000);

  /** @scenario "The CLI stops when an organization denies its copy approval" */
  it("names the denied request and copies nothing", async () => {
    decisions = { req_source: "denied" };

    const result = await run(["ops", "copy", "--from", "acme", "--to", "globex"]);

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr + result.stdout).toMatch(/Request req_source was denied/);
    expect(copyCall).toBeNull();
  }, 30_000);

  /** @scenario "The CLI stops when an approval expires before it is decided" */
  it("names the expired request and copies nothing", async () => {
    decisions = { req_target: "expired" };

    const result = await run(["ops", "copy", "--from", "acme", "--to", "globex"]);

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr + result.stdout).toMatch(
      /Request req_target expired before it was approved/,
    );
    expect(copyCall).toBeNull();
    expect(ended).toEqual(["req_source"]);
  }, 30_000);

  /** @scenario "The CLI names a session it could not end even when the copy failed first" */
  it("reports the live source session when the target expired and ending the source failed", async () => {
    decisions = { req_target: "expired" };
    endRefused = new Set(["req_source"]);

    const result = await run([
      "ops",
      "copy",
      "--from",
      "acme",
      "--to",
      "globex",
      "--format",
      "json",
    ]);

    expect(result.exitCode).not.toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      ok: false,
      error: { code: "copy_sessions_still_live", meta: { requestIds: ["req_source"] } },
    });
    expect(copyCall).toBeNull();
  }, 30_000);

  /** @scenario "The CLI stops when a redeemed approval carries no ops token" */
  it("refuses a redeem answer without an ops token and copies nothing", async () => {
    redeemWithoutToken = true;

    const result = await run(["ops", "copy", "--from", "acme", "--to", "globex"]);

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr + result.stdout).toMatch(
      /Request req_source was redeemed without an ops token/,
    );
    expect(copyCall).toBeNull();
  }, 30_000);

  /** @scenario "The CLI refuses a copy into the same organization" */
  it("refuses --from and --to naming the same organization before any request", async () => {
    const result = await run([
      "ops",
      "copy",
      "--from",
      "acme",
      "--to",
      " acme ",
      "--format",
      "json",
    ]);

    expect(result.exitCode).not.toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      ok: false,
      error: {
        code: "validation_error",
        message: expect.stringMatching(/name the same organization/),
      },
    });
    expect(requests).toEqual([]);
  }, 30_000);

  /** @scenario "The CLI refuses a reason over 500 characters" */
  it("refuses a reason over 500 characters before any request", async () => {
    const result = await run([
      "ops",
      "copy",
      "--from",
      "acme",
      "--to",
      "globex",
      "--reason",
      "x".repeat(501),
      "--format",
      "json",
    ]);

    expect(result.exitCode).not.toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      ok: false,
      error: {
        code: "validation_error",
        message: expect.stringMatching(/limited to 500 characters/),
      },
    });
    expect(requests).toEqual([]);
  }, 30_000);

  /** @scenario "The CLI says why a copy stopped early" */
  it("prints why the copy stopped early", async () => {
    stoppedBecause = "approval_revoked";

    const result = await run(["ops", "copy", "--from", "acme", "--to", "globex", "--dry-run"]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toMatch(/Stopped early \(approval_revoked\): an approval ended\./);
    expect(ended.toSorted()).toEqual(["req_source", "req_target"]);
  }, 30_000);
});
