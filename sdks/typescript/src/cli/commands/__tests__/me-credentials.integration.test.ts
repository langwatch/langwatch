/**
 * The /me credentials story, end to end against the REAL built CLI and a real
 * HTTP server: a device session alone (no env vars anywhere) powers data
 * commands via the personal project's API key, the lazy exchange happens
 * exactly once and rewrites the session file, the identity notice rides
 * stderr while `-o json` stdout stays parseable, and headless project login
 * fails fast instead of blocking on a browser.
 *
 * Requires `pnpm build` (like the other CLI integration tests in this package).
 *
 * Feature: specs/ai-governance/cli-onboarding/me-credentials.feature
 * Feature: specs/ai-governance/cli-onboarding/login-unified.feature
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as http from "node:http";
import * as os from "node:os";
import * as path from "node:path";
import type { AddressInfo } from "node:net";

const CLI_PATH = path.resolve(__dirname, "../../../../dist/cli/index.js");

interface RunResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
}

const PERSONAL_KEY = "pkey_integration_personal";

let server: http.Server;
let endpoint = "";
let stateDir: string;
let workDir: string;
let personalProjectCalls = 0;
let refreshCalls = 0;
let lastSearchAuth: string | null = null;
let lastMonitorsAuth: string | null = null;
/** When true the device session is revoked server-side: the session-
 * authenticated endpoints AND refresh all 401, exactly as they would after a
 * /me/devices revocation dropped the Redis tokens. */
let sessionRevoked = false;

const configPath = () => path.join(stateDir, "config.json");

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
      ...extra,
    }),
  );
};

const readSession = () => JSON.parse(fs.readFileSync(configPath(), "utf8")) as Record<string, any>;

const run = (
  args: string[],
  env: Record<string, string> = {},
  cwd: string = workDir,
): Promise<RunResult> =>
  new Promise((resolve) => {
    // The runner's own shell (and the repo .env vitest loads) may carry a
    // real LANGWATCH_API_KEY; the whole point here is a CLI with NO key in
    // its environment, so scrub it before overlaying the test's env. The
    // agent-mode markers (CLAUDECODE etc.) are scrubbed too: an agent
    // running this suite would otherwise flip the CLI into agents format
    // and change which rendering the assertions see.
    const baseEnv: Record<string, string | undefined> = { ...process.env };
    delete baseEnv.LANGWATCH_API_KEY;
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
      cwd,
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
        personalProjectCalls++;
        if (sessionRevoked || auth !== "Bearer lw_at_valid") {
          json(401, { error: "unauthorized" });
          return;
        }
        json(200, {
          project: {
            id: "proj_personal",
            slug: "personal-dev",
            name: "Personal Workspace",
            api_key: PERSONAL_KEY,
          },
        });
        return;
      }

      if (url.startsWith("/api/auth/cli/refresh")) {
        refreshCalls++;
        const parsed = JSON.parse(body || "{}") as { refresh_token?: string };
        if (sessionRevoked || parsed.refresh_token !== "lw_rt_valid") {
          json(401, { error: "invalid_grant" });
          return;
        }
        json(200, {
          access_token: "lw_at_valid",
          token_type: "Bearer",
          expires_in: 3600,
          refresh_token: "lw_rt_valid",
          refresh_expires_in: 2592000,
        });
        return;
      }

      if (url.startsWith("/api/auth/cli/project-key")) {
        if (auth !== "Bearer lw_at_valid") {
          json(401, { error: "unauthorized" });
          return;
        }
        const parsed = JSON.parse(body || "{}") as { slug?: string };
        if (parsed.slug !== "checkout") {
          json(404, {
            error: "not_found",
            error_description: `No project with slug "${parsed.slug}" in your organization`,
          });
          return;
        }
        json(200, {
          api_key: "sk-lw-checkout-key",
          project: { id: "proj_checkout", slug: "checkout", name: "Checkout" },
        });
        return;
      }

      if (url.startsWith("/api/me/project")) {
        json(200, {
          id: "proj_x",
          name: "Env Project",
          slug: "env-project",
          isPersonal: false,
        });
        return;
      }

      if (url.startsWith("/api/traces/search")) {
        lastSearchAuth = auth;
        json(200, {
          traces: [],
          pagination: { totalHits: 0 },
        });
        return;
      }

      if (url.startsWith("/api/monitors")) {
        // A command that reads process.env.LANGWATCH_API_KEY directly (not via
        // the client-factory default) — the sweep must feed it the scoped key.
        lastMonitorsAuth = auth;
        json(200, []);
        return;
      }

      json(404, { error: "not_found" });
    });
  });
  await new Promise<void>((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
  endpoint = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}, 30_000);

afterAll(async () => {
  await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
});

beforeEach(() => {
  stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "lw-me-creds-"));
  workDir = fs.mkdtempSync(path.join(os.tmpdir(), "lw-me-work-"));
  personalProjectCalls = 0;
  refreshCalls = 0;
  lastSearchAuth = null;
  lastMonitorsAuth = null;
  sessionRevoked = false;
});

afterEach(() => {
  fs.rmSync(stateDir, { recursive: true, force: true });
  fs.rmSync(workDir, { recursive: true, force: true });
});

describe("device session powers data commands with zero env vars", () => {
  /** @scenario a session created before this change lazily exchanges once and rewrites the session file */
  it("lazily exchanges the personal key once, rewrites config.json, then stays off the network", async () => {
    writeSession(); // no personal_project: a pre-change session

    const first = await run(["trace", "search", "-o", "json"]);
    expect(first.exitCode).toBe(0);
    expect(personalProjectCalls).toBe(1);
    expect(lastSearchAuth).toBe(`Bearer ${PERSONAL_KEY}`);
    expect(readSession().personal_project?.api_key).toBe(PERSONAL_KEY);

    const second = await run(["trace", "search", "-o", "json"]);
    expect(second.exitCode).toBe(0);
    expect(personalProjectCalls).toBe(1);
  });

  it("feeds the scoped session key to commands that read the key directly, not just the trace client", async () => {
    // `monitors list` reads process.env.LANGWATCH_API_KEY itself rather than
    // going through the client-factory default, so it guards the sweep that
    // made those call sites prefer the request-scoped key in device mode.
    writeSession({
      personal_project: {
        id: "proj_personal",
        slug: "personal-dev",
        name: "Personal Workspace",
        api_key: PERSONAL_KEY,
        validated_at: Math.floor(Date.now() / 1000),
      },
    });

    const result = await run(["monitor", "list", "-o", "json"]);

    expect(result.exitCode).toBe(0);
    expect(lastMonitorsAuth).toBe(`Bearer ${PERSONAL_KEY}`);
  });

  /** @scenario device-session revocation severs CLI access and wipes the cached key */
  it("stops authenticating after the session is revoked, wiping the cached key", async () => {
    // A live session with a personal key whose validation clock is stale, so
    // the next command must re-confirm liveness before trusting the key.
    writeSession({
      personal_project: {
        id: "proj_personal",
        slug: "personal-dev",
        name: "Personal Workspace",
        api_key: PERSONAL_KEY,
        validated_at: Math.floor(Date.now() / 1000) - 3600, // past the window
      },
    });

    // The device is revoked from /me/devices: Redis tokens are gone, so the
    // session endpoints and refresh all 401.
    sessionRevoked = true;

    const result = await run(["trace", "search"]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain(
      "Error: you're not logged in, and LANGWATCH_API_KEY is not set.",
    );
    // The command never reached the API with the stolen key...
    expect(lastSearchAuth).toBeNull();
    // ...and the cached key is gone from the retained config, so a copied
    // ~/.langwatch/config.json is now inert.
    expect(readSession().personal_project).toBeUndefined();
  });

  /** @scenario the lazy exchange refreshes an expired access token before giving up */
  it("refreshes an expired session before the exchange", async () => {
    writeSession({
      expires_at: Math.floor(Date.now() / 1000) - 60, // already expired
    });

    const result = await run(["trace", "search", "-o", "json"]);

    expect(result.exitCode).toBe(0);
    expect(refreshCalls).toBeGreaterThanOrEqual(1);
    expect(lastSearchAuth).toBe(`Bearer ${PERSONAL_KEY}`);
  });

  /** @scenario -o json keeps stdout parseable while the notice goes to stderr */
  it("keeps -o json stdout parseable and puts the identity notice on stderr", async () => {
    writeSession({
      personal_project: {
        id: "proj_personal",
        slug: "personal-dev",
        name: "Personal Workspace",
        api_key: PERSONAL_KEY,
      },
    });

    const result = await run(["trace", "search", "-o", "json"]);

    expect(result.exitCode).toBe(0);
    expect(() => JSON.parse(result.stdout)).not.toThrow();
    expect(result.stderr).toContain(
      "Using your personal project (device login). Read another project: langwatch login --project",
    );
    // Suppressed on the immediately following run (30-minute window).
    const repeat = await run(["trace", "search", "-o", "json"]);
    expect(repeat.stderr).not.toContain("Using your personal project");
  });

  it("still prefers LANGWATCH_API_KEY over the session, and says which project it is", async () => {
    writeSession({
      personal_project: {
        id: "proj_personal",
        slug: "personal-dev",
        name: "Personal Workspace",
        api_key: PERSONAL_KEY,
      },
    });

    const result = await run(["trace", "search", "-o", "json"], {
      LANGWATCH_API_KEY: "sk-env-key",
    });

    expect(result.exitCode).toBe(0);
    expect(lastSearchAuth).toBe("Bearer sk-env-key");
    expect(result.stderr).toContain('Using API key for project "Env Project"');
  });

  it("reports the not-logged-in error when there is no session and no env var", async () => {
    // No config.json at all.
    const result = await run(["trace", "search"]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain(
      "Error: you're not logged in, and LANGWATCH_API_KEY is not set.",
    );
    expect(result.stderr).toContain("Sign in with your browser, interactively:");
    expect(result.stderr).toContain("  langwatch login");
  });
});

describe("headless project login", () => {
  /** @scenario headless `langwatch login --project` fails fast instead of waiting on a browser */
  it("fails fast on --project with no TTY, naming every non-interactive path", async () => {
    const startedAt = Date.now();
    const result = await run(["login", "--project"]);

    expect(result.exitCode).toBe(1);
    // Fail-fast means seconds, not the device-code poll's ten minutes.
    expect(Date.now() - startedAt).toBeLessThan(15_000);
    expect(result.stderr).toContain("langwatch login --project <slug>");
    expect(result.stderr).toContain("langwatch login --api-key <key>");
    expect(result.stderr).toContain("LANGWATCH_API_KEY");
  });

  it("writes the resolved key to .env for --project <slug> with a live session", async () => {
    writeSession();

    const result = await run(["login", "--project", "checkout"]);

    expect(result.exitCode).toBe(0);
    const envFile = fs.readFileSync(path.join(workDir, ".env"), "utf8");
    expect(envFile).toContain("LANGWATCH_API_KEY=sk-lw-checkout-key");
    expect(result.stdout).toContain("Checkout");
  });

  it("explains the fix when --project <slug> names an unknown project", async () => {
    writeSession();

    const result = await run(["login", "--project", "nope"]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('No project with slug "nope"');
  });
});
