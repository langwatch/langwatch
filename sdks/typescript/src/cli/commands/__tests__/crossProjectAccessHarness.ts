/**
 * The fixture the cross-project-access suites share: a real HTTP server
 * standing in for the platform, a temporary CLI config, and a runner that
 * spawns the REAL built CLI against both.
 *
 * The server records the exact `Authorization` header of every data request,
 * because that header IS the feature: a user-scoped key carries no project
 * identity, so `Basic base64(projectId:key)` is the only thing that tells the
 * platform which project the command means.
 *
 * Requires `pnpm build` (like the other CLI integration tests in this
 * package). One `installCrossProjectHarness()` call per suite file installs
 * the hooks and returns everything the cases read.
 *
 * Feature: specs/typescript-sdk/cli-cross-project-access.feature
 */
import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as http from "node:http";
import type { AddressInfo } from "node:net";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach } from "vitest";

const CLI_PATH = path.resolve(__dirname, "../../../../dist/cli/index.js");

/** The user-scoped login key: `sk-lw-{lookupId}_{secret}`, per the contract. */
export const LOGIN_KEY = "sk-lw-cliLookup01_clisecret01";
/** The personal project's own key: the legacy shape, no underscore. */
export const PERSONAL_KEY = "sk-lw-personalprojectkey";

export const PERSONAL_PROJECT = {
  id: "proj_personal",
  slug: "personal-dev",
  name: "Personal Workspace",
  api_key: PERSONAL_KEY,
};

/** A second project the login key reaches, addressable by id and by slug. */
export const OTHER_PROJECT = {
  id: "proj-b",
  name: "Checkout Agent",
  slug: "checkout-agent",
  language: "python",
  framework: "langchain",
  teamId: "team_1",
  piiRedactionLevel: "ESSENTIAL",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

export const PERSONAL_PROJECT_ROW = {
  id: PERSONAL_PROJECT.id,
  name: PERSONAL_PROJECT.name,
  slug: PERSONAL_PROJECT.slug,
  language: "python",
  framework: "langchain",
  teamId: "team_personal",
  piiRedactionLevel: "ESSENTIAL",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

export interface RunResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
}

/** What the platform recorded while the last command ran. */
export interface RecordedRequests {
  searchAuth: string | null;
  traceGetAuth: string | null;
  projectsAuth: string | null;
  sessionEventsAuth: string | null;
  projectsListCalls: number;
}

export interface CrossProjectHarness {
  /** Write a logged-in CLI config, with any extra keys merged in. */
  writeSession: (extra?: Record<string, unknown>) => void;
  /** Run the built CLI with the harness environment. */
  run: (args: { args: string[]; env?: Record<string, string> }) => Promise<RunResult>;
  /** The header a user-scoped key produces for a named project. */
  basicFor: (args: { projectId: string; apiKey: string }) => string;
  /** What the platform saw during the current case. */
  recorded: RecordedRequests;
}

/**
 * Install the server, the temporary directories and the per-case reset.
 * Call once at the top level of a suite file.
 */
export function installCrossProjectHarness(): CrossProjectHarness {
  let server: http.Server;
  let endpoint = "";
  let stateDir = "";
  let workDir = "";
  const recorded: RecordedRequests = {
    searchAuth: null,
    traceGetAuth: null,
    projectsAuth: null,
    sessionEventsAuth: null,
    projectsListCalls: 0,
  };

  const configPath = () => path.join(stateDir, "config.json");

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      const url = req.url ?? "";
      let body = "";
      req.on("data", (c: Buffer) => (body += c.toString()));
      req.on("end", () => {
        const auth = req.headers.authorization ?? "";
        const json = (status: number, payload: unknown) => {
          res.writeHead(status, { "content-type": "application/json" });
          res.end(JSON.stringify(payload));
        };

        if (url.startsWith("/api/auth/cli/personal-project")) {
          if (auth !== "Bearer lw_at_valid") {
            json(401, { error: "unauthorized" });
            return;
          }
          json(200, { project: PERSONAL_PROJECT });
          return;
        }

        if (url.startsWith("/api/projects")) {
          recorded.projectsListCalls++;
          recorded.projectsAuth = auth;
          // The platform filters the listing by what the credential can view,
          // so only the login key sees both projects.
          const visible =
            auth === `Bearer ${LOGIN_KEY}`
              ? [PERSONAL_PROJECT_ROW, OTHER_PROJECT]
              : [PERSONAL_PROJECT_ROW];
          json(200, {
            data: visible,
            pagination: {
              page: 1,
              limit: 100,
              total: visible.length,
              totalPages: 1,
            },
          });
          return;
        }

        if (url.startsWith("/api/traces/search")) {
          recorded.searchAuth = auth;
          json(200, { traces: [], pagination: { totalHits: 0 } });
          return;
        }

        if (url.startsWith("/api/coding-agent/sessions/")) {
          recorded.sessionEventsAuth = auth;
          json(200, { events: [], nextCursor: null });
          return;
        }

        if (url.startsWith("/api/traces/")) {
          recorded.traceGetAuth = auth;
          json(200, { trace_id: "abc123" });
          return;
        }

        if (url.startsWith("/api/me/project")) {
          json(200, {
            id: PERSONAL_PROJECT.id,
            name: PERSONAL_PROJECT.name,
            slug: PERSONAL_PROJECT.slug,
            isPersonal: true,
          });
          return;
        }

        json(404, { error: "not_found" });
      });
    });
    await new Promise<void>((resolveListen) =>
      server.listen(0, "127.0.0.1", resolveListen),
    );
    endpoint = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  }, 30_000);

  afterAll(async () => {
    await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
  });

  beforeEach(() => {
    stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "lw-xproj-state-"));
    workDir = fs.mkdtempSync(path.join(os.tmpdir(), "lw-xproj-work-"));
    recorded.searchAuth = null;
    recorded.traceGetAuth = null;
    recorded.projectsAuth = null;
    recorded.sessionEventsAuth = null;
    recorded.projectsListCalls = 0;
  });

  afterEach(() => {
    fs.rmSync(stateDir, { recursive: true, force: true });
    fs.rmSync(workDir, { recursive: true, force: true });
  });

  const writeSession = (extra: Record<string, unknown> = {}) => {
    fs.writeFileSync(
      configPath(),
      JSON.stringify({
        control_plane_url: endpoint,
        gateway_url: "http://localhost:5563",
        access_token: "lw_at_valid",
        refresh_token: "lw_rt_valid",
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        user: { id: "user_1", email: "dev@example.com", name: "Dev" },
        organization: { id: "org_1", name: "Acme", slug: "acme" },
        personal_project: {
          ...PERSONAL_PROJECT,
          validated_at: Math.floor(Date.now() / 1000),
        },
        ...extra,
      }),
    );
  };

  const run = ({
    args,
    env = {},
  }: {
    args: string[];
    env?: Record<string, string>;
  }): Promise<RunResult> =>
    new Promise((resolve) => {
      // The runner's own shell (and the repo .env vitest loads) may carry a
      // real LANGWATCH_API_KEY; every case here is about a CLI with NO key in
      // its environment except where the case sets one. The agent-mode
      // markers are scrubbed too, or an agent running this suite would flip
      // the CLI into agents format and change which rendering the assertions
      // see.
      const baseEnv: Record<string, string | undefined> = { ...process.env };
      delete baseEnv.LANGWATCH_API_KEY;
      delete baseEnv.LANGWATCH_PROJECT_ID;
      for (const marker of [
        "CLAUDECODE",
        "CLAUDE_CODE",
        "CURSOR_AGENT",
        "GITHUB_COPILOT",
        "AMAZON_Q",
        "LW_AGENT_MODE",
        "LANGWATCH_AGENT_MODE",
      ]) {
        delete baseEnv[marker];
      }
      const child = spawn(process.execPath, [CLI_PATH, ...args], {
        cwd: workDir,
        // stdio: "pipe" makes this a non-TTY invocation, the agent shape.
        stdio: ["ignore", "pipe", "pipe"],
        env: {
          ...baseEnv,
          LANGWATCH_ENDPOINT: endpoint,
          LANGWATCH_CLI_CONFIG: configPath(),
          LANGWATCH_NO_DAEMON: "1",
          LANGWATCH_DAEMON_NO_SPAWN: "1",
          ...env,
        },
      });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString()));
      child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
      child.on("close", (exitCode) => resolve({ stdout, stderr, exitCode }));
    });

  const basicFor = ({
    projectId,
    apiKey,
  }: {
    projectId: string;
    apiKey: string;
  }): string =>
    `Basic ${Buffer.from(`${projectId}:${apiKey}`, "utf-8").toString("base64")}`;

  return { writeSession, run, basicFor, recorded };
}

/** The scope value for a login key that reaches the whole organization. */
export const ORG_WIDE_SCOPE = {
  kind: "organization" as const,
  project_ids: [] as string[],
};
