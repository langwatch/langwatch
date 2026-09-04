/**
 * One local stack for an end-to-end suite, resolved in this order:
 *
 *   1. `LANGWATCH_E2E_BASE_URL` — CI sets it, and then nothing is started.
 *   2. This worktree's haven stack, when one is up.
 *   3. A stack already answering at the caller's address.
 *   4. Otherwise `dev/scripts/dev-stack.sh` on the port slot the suite asks for,
 *      stopped again when the suite is done.
 */
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";

/**
 * The workspace root, found by walking up from the working directory to the
 * one lockfile. Read at load time rather than from `import.meta.url`, because
 * a Playwright suite loads this module as CommonJS and the other suites load
 * it as an ES module.
 */
function findRepoRoot(): string {
  let here = process.cwd();
  for (let up = 0; up < 12; up++) {
    if (existsSync(resolve(here, "pnpm-workspace.yaml"))) return here;
    const parent = dirname(here);
    if (parent === here) break;
    here = parent;
  }
  throw new Error(
    `no pnpm-workspace.yaml above ${process.cwd()}; run the suite inside the repository`,
  );
}

export const REPO_ROOT = findRepoRoot();

const SEED_FILE = resolve(REPO_ROOT, "packages/prisma-client/prisma/seed.ts");

/** A stack a suite can talk to, and the way to put it back down. */
export type RunningStack = Readonly<{
  baseUrl: string;
  /** The api process, which the browser reaches through the ui lane's proxy. */
  apiUrl: string;
  /** Where this address came from, for the line the suite prints. */
  source: "environment" | "haven" | "already-serving" | "booted";
  /** True when this call started the processes and `stop` will end them. */
  started: boolean;
  stop: () => Promise<void>;
}>;

export type StartStackOptions = Readonly<{
  /** The ui lane's port when this call boots one. */
  port: number;
  /** An address to use when something already answers there. */
  baseUrlHint?: string;
  /** How long the three probes get before the boot is called a failure. */
  readyTimeoutMs?: number;
  /** Extra environment for the lanes, on top of what `dev-stack.sh` derives. */
  env?: Readonly<Record<string, string>>;
  /** Where the launcher's own output goes. Defaults to this process's stdout. */
  logToConsole?: boolean;
}>;

const DEFAULT_READY_TIMEOUT_MS = 300_000;
const PROBE_INTERVAL_MS = 2_000;

async function answers(url: string, timeoutMs = 5_000): Promise<boolean> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    return response.status < 400;
  } catch {
    return false;
  }
}

async function probe(
  url: string,
  accept: (status: number) => boolean,
  timeoutMs: number,
  label: string,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let last = "no attempt made";
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(5_000) });
      if (accept(response.status)) return;
      last = `status ${response.status}`;
    } catch (error) {
      last = error instanceof Error ? error.message : String(error);
    }
    await new Promise((done) => setTimeout(done, PROBE_INTERVAL_MS));
  }
  throw new Error(`${label} never became ready at ${url} (last: ${last})`);
}

// --- haven ------------------------------------------------------------------

type HavenService = Readonly<{ name?: string; url?: string; listening?: boolean }>;
type HavenLane = Readonly<{ name?: string; listening?: boolean }>;
type HavenStack = Readonly<{
  slug?: string;
  live?: boolean;
  services?: readonly HavenService[];
  lanes?: readonly HavenLane[];
}>;

/** This worktree's stack slug, the way haven derives it. */
function worktreeSlug(): string {
  const cached = resolve(REPO_ROOT, ".langwatch-slug");
  if (existsSync(cached)) {
    const named = readFileSync(cached, "utf8").trim();
    if (named) return named;
  }
  return basename(REPO_ROOT)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** The haven binary, on PATH or built in the tree. Absent means no haven. */
function havenBinary(): string | null {
  const candidates = [
    "haven",
    resolve(REPO_ROOT, "tools/thuishaven/haven"),
    resolve(REPO_ROOT, "tools/thuishaven/cmd/haven/haven"),
  ];
  for (const candidate of candidates) {
    try {
      execFileSync(candidate, ["--version"], { stdio: "ignore", timeout: 20_000 });
      return candidate;
    } catch {
      // Not this one; a missing haven is a normal state, not a failure.
    }
  }
  return null;
}

/**
 * The address of this worktree's haven stack, when one is up and serving. Any
 * failure — no binary, no daemon, no stack, a stack that is registered but not
 * live — answers null, because booting one is a perfectly good alternative.
 */
function havenBaseUrl(): string | null {
  const binary = havenBinary();
  if (!binary) return null;

  let report: { stacks?: readonly HavenStack[] };
  try {
    const out = execFileSync(binary, ["status", "--json", "--agent"], {
      cwd: REPO_ROOT,
      encoding: "utf8",
      timeout: 60_000,
      maxBuffer: 8 * 1024 * 1024,
    });
    report = JSON.parse(out);
  } catch {
    return null;
  }

  const slug = worktreeSlug();
  const stack = (report.stacks ?? []).find((candidate) => candidate.slug === slug);
  if (!stack?.live) return null;

  const app = (stack.services ?? []).find((service) => service.name === "app");
  if (!app?.listening || !app.url) return null;

  // A stack whose api lane is down serves pages and answers nothing, which is
  // the one failure that looks like a healthy stack until a test asks for data.
  const api = (stack.lanes ?? []).find((lane) => lane.name === "api");
  if (api && !api.listening) return null;

  return app.url.replace(/\/$/, "");
}

// --- booting ----------------------------------------------------------------

function stopGroup(child: ChildProcess, ports: readonly number[]): Promise<void> {
  return new Promise((done) => {
    const pid = child.pid;
    if (pid === undefined || child.exitCode !== null) {
      done();
      return;
    }
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      // concurrently replaces a lane that dies, so a freed port is not a
      // stopped stack. The repo's own sweeper takes the whole group by port.
      spawn("bash", [resolve(REPO_ROOT, "dev/scripts/kill-dev-tree.sh"), ports.join(",")], {
        stdio: "ignore",
        cwd: REPO_ROOT,
      }).on("exit", () => done());
    };
    child.once("exit", finish);
    try {
      process.kill(-pid, "SIGTERM");
    } catch {
      finish();
    }
    setTimeout(finish, 10_000);
  });
}

function borrowed(baseUrl: string, source: RunningStack["source"]): RunningStack {
  return {
    baseUrl,
    apiUrl: `${baseUrl}/api`,
    source,
    started: false,
    stop: async () => {},
  };
}

/** Resolves a stack to run against, booting one only as the last resort. */
export async function startStack(options: StartStackOptions): Promise<RunningStack> {
  const { port, readyTimeoutMs = DEFAULT_READY_TIMEOUT_MS } = options;
  const apiPort = port + 1000;
  const workerPort = port - 2561;

  const named = process.env.LANGWATCH_E2E_BASE_URL;
  if (named) return borrowed(named.replace(/\/$/, ""), "environment");

  const haven = havenBaseUrl();
  if (haven) return borrowed(haven, "haven");

  const hint = options.baseUrlHint?.replace(/\/$/, "");
  if (hint && (await answers(hint))) return borrowed(hint, "already-serving");

  const baseUrl = `http://localhost:${port}`;
  const child = spawn("bash", [resolve(REPO_ROOT, "dev/scripts/dev-stack.sh")], {
    cwd: REPO_ROOT,
    detached: true,
    stdio: options.logToConsole === false ? "ignore" : ["ignore", "inherit", "inherit"],
    env: {
      ...process.env,
      NODE_ENV: "development",
      PORT: String(port),
      LANGWATCH_ENDPOINT: baseUrl,
      BLOCK_LOCAL_HTTP_CALLS: "false",
      ...options.env,
    },
  });

  const ports = [port, apiPort, workerPort];
  const stop = () => stopGroup(child, ports);

  let boots = true;
  child.once("exit", (code) => {
    boots = false;
    if (code !== 0 && code !== null) {
      console.error(`dev-stack.sh exited with code ${code} before the stack was ready`);
    }
  });

  try {
    await probe(baseUrl, (status) => status < 400, readyTimeoutMs, "ui lane");
    await probe(
      `${baseUrl}/api/health`,
      (status) => status === 204 || status === 200,
      readyTimeoutMs,
      "api lane",
    );
    await probe(
      `http://localhost:${workerPort}/healthz`,
      (status) => status === 200,
      readyTimeoutMs,
      "worker lane",
    );
  } catch (error) {
    await stop();
    throw error;
  }

  if (!boots) {
    await stop();
    throw new Error("dev-stack.sh exited before every lane answered");
  }

  return { baseUrl, apiUrl: `${baseUrl}/api`, source: "booted", started: true, stop };
}

export type SeededProject = Readonly<{
  organizationId: string;
  teamId: string;
  projectId: string;
  projectSlug: string;
  apiKey: string;
  adminEmail: string;
  adminPassword: string;
}>;

function seedConstant(source: string, name: string): string {
  const match = new RegExp(`^const ${name} = "([^"]*)";`, "m").exec(source);
  if (!match?.[1]) {
    throw new Error(
      `${name} is no longer a top-level string constant in ${SEED_FILE}; ` +
        `update seededProject() to match the seed rather than retyping its values`,
    );
  }
  return match[1];
}

/**
 * What `pnpm prisma:seed` puts in the database, read out of the seed itself so
 * the two can never drift. The browser journey signs up fresh and does not use
 * this; the SDK, CLI and MCP suites need a key before their first call.
 */
export function seededProject(): SeededProject {
  const source = readFileSync(SEED_FILE, "utf8");
  return {
    organizationId: seedConstant(source, "ORG_ID"),
    teamId: seedConstant(source, "TEAM_ID"),
    projectId: seedConstant(source, "PROJECT_ID"),
    projectSlug: seedConstant(source, "PROJECT_SLUG"),
    apiKey: seedConstant(source, "DEFAULT_INGESTION_KEY"),
    adminEmail: seedConstant(source, "ADMIN_EMAIL"),
    adminPassword: seedConstant(source, "ADMIN_PASSWORD"),
  };
}
