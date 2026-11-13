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
    return { status: 200, payload: { organizationId: "org", opsToken: OPS_TOKENS[requestId] } };
  }
  if (match[2] === "/end") {
    ended.push(requestId);
    return { status: 200, payload: { status: "revoked" } };
  }
  return { status: 200, payload: { status: "approved" } };
};

const route = ({ req, body }: { req: http.IncomingMessage; body: string }): Reply => {
  const url = req.url ?? "";
  const auth = req.headers.authorization ?? "";
  if (req.method === "POST" && url === "/api/staff-access/ops/copies") {
    copyCall = { auth, body: JSON.parse(body) as Record<string, unknown> };
    return { status: 200, payload: report };
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
      expect.objectContaining({ scopes: ["ops:copy", "org:content"], organization: "acme" }),
      expect.objectContaining({ scopes: ["ops:copy", "org:support"], organization: "globex" }),
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
});
