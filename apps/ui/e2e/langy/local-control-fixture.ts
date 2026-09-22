/**
 * The harness for the local control scenarios (ADR-129). See README.md
 * "local-control-fixture.ts" for what it builds and why nothing is mocked.
 * @see specs/langy/langy-dogfood-scenarios.feature
 */

import { execFileSync, spawn, spawnSync } from "node:child_process";
import {
  closeSync,
  existsSync,
  promises as fs,
  openSync,
  readFileSync,
  realpathSync,
} from "node:fs";
import * as net from "node:net";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { APP_BASE, CONFIG } from "./config";
import { type LangyAdapter, type LangyToolEvent, toolEventOf } from "./langy-agent";
import { getSessionCookie, trpcMutate, trpcQuery } from "./trpc";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** The repository root of this checkout, from `apps/ui/e2e/langy`. */
export const REPO_ROOT = path.resolve(__dirname, "../../../..");

/**
 * Where a run puts the temporary folders it shares with Langy — outside
 * every checkout, on purpose (README.md "local-control-fixture.ts").
 */
export const SCENARIO_REPO_DIR =
  process.env.LANGY_SCENARIO_REPO_DIR ?? path.join(os.homedir(), ".langwatch-scenario-repos");

/**
 * The demo applications a scenario can share: the two ACME support agents,
 * and the ACME checkout agent, a LangGraph application with no LangWatch
 * dependency at all that the guided onboarding has Langy instrument.
 */
export type DemoLanguage = "python" | "typescript" | "langgraph";

interface DemoSource {
  /** The folder copied into the temporary repository. */
  dir: string;
  /** What installs and runs the copy. */
  runtime: "uv" | "npm";
  /** The subject of the copy's first commit. */
  commit: string;
}

const DEMO: Record<DemoLanguage, DemoSource> = {
  python: {
    dir: path.join(REPO_ROOT, "dev", "dogfood", "acme-support", "python"),
    runtime: "uv",
    commit: "chore: the ACME support agent",
  },
  typescript: {
    dir: path.join(REPO_ROOT, "dev", "dogfood", "acme-support", "typescript"),
    runtime: "npm",
    commit: "chore: the ACME support agent",
  },
  langgraph: {
    dir: path.join(REPO_ROOT, "dev", "dogfood", "acme-checkout", "python"),
    runtime: "uv",
    commit: "chore: the ACME checkout agent",
  },
};

/**
 * Never copied: they are rebuilt in the temporary repository, or they are
 * noise. `.env` is the developer's own credentials in the source folder; the
 * copy gets the ones its launcher writes.
 */
const SKIPPED_ENTRIES = new Set([
  ".git",
  ".env",
  ".venv",
  "node_modules",
  "__pycache__",
  ".pytest_cache",
  ".mypy_cache",
  "dist",
]);

const sh = (
  command: string,
  args: string[],
  options: { cwd?: string; env?: NodeJS.ProcessEnv; timeoutMs?: number } = {},
): string =>
  execFileSync(command, args, {
    encoding: "utf8",
    ...(options.cwd ? { cwd: options.cwd } : {}),
    ...(options.env ? { env: options.env } : {}),
    timeout: options.timeoutMs ?? 600_000,
    maxBuffer: 32 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  }).toString();

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * The model key the demo applications need, from the environment or from
 * the workspace-root `.env`, which is where this checkout keeps it.
 */
export function openaiKey(): string {
  const fromEnvironment = process.env.OPENAI_API_KEY;
  if (fromEnvironment) return fromEnvironment;
  try {
    const dotenv = readFileSync(path.join(REPO_ROOT, ".env"), "utf8");
    return /^OPENAI_API_KEY=(.*)$/m.exec(dotenv)?.[1]?.trim() ?? "";
  } catch {
    return "";
  }
}

/**
 * The provider values the demo app reads from its own `.env`, moved by
 * LANGY_GUIDED_PROVIDER the same way it moves Langy and the judge.
 */
export function demoProviderEnvLines(): string[] {
  if (process.env.LANGY_GUIDED_PROVIDER !== "azure") {
    return [`OPENAI_API_KEY=${openaiKey()}`];
  }
  const resource = process.env.AZURE_RESOURCE_NAME;
  const key = process.env.AZURE_API_KEY;
  if (!resource || !key) {
    throw new Error(
      "AZURE_RESOURCE_NAME and AZURE_API_KEY are required with LANGY_GUIDED_PROVIDER=azure",
    );
  }
  return [
    `AZURE_OPENAI_ENDPOINT=https://${resource}.openai.azure.com`,
    `AZURE_OPENAI_API_KEY=${key}`,
    `AZURE_OPENAI_API_VERSION=${process.env.AZURE_API_VERSION ?? "2024-10-21"}`,
  ];
}

/**
 * Polls until `read` answers something truthy. Every wait in this file
 * goes through here so a timeout says what it was waiting for.
 */
async function waitFor<T>({
  what,
  read,
  timeoutMs,
  intervalMs = 1_000,
}: {
  what: string;
  read: () => Promise<T | null | undefined | false> | T | null | undefined | false;
  timeoutMs: number;
  intervalMs?: number;
}): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown = null;
  for (;;) {
    try {
      const value = await read();
      if (value) return value as T;
    } catch (error) {
      lastError = error;
    }
    if (Date.now() > deadline) {
      throw new Error(
        `Timed out after ${Math.round(timeoutMs / 1000)}s waiting for ${what}${
          lastError ? ` (last error: ${stringField(lastError)})` : ""
        }`,
      );
    }
    await sleep(intervalMs);
  }
}

// ---------------------------------------------------------------------------
// The credential the command line runs on
// ---------------------------------------------------------------------------

let cliApiKeyPromise: Promise<string> | null = null;

/** The organization that holds the test project. */
async function organizationIdOfProject(cookie: string): Promise<string> {
  const organizations = await trpcQuery<
    {
      id: string;
      teams?: { projects?: { id: string }[] }[];
    }[]
  >({ cookie, path: "organization.getAll", input: {} });
  const organizationId =
    organizations.find((organization) =>
      (organization.teams ?? []).some((team) =>
        (team.projects ?? []).some((project) => project.id === CONFIG.PROJECT_ID),
      ),
    )?.id ?? organizations[0]?.id;
  if (!organizationId) {
    throw new Error(`no organization holds project ${CONFIG.PROJECT_ID}; check LANGY_PROJECT_ID`);
  }
  return organizationId;
}

/** What `POST /api/auth/cli/exchange` answers a device-session login with. */
interface DeviceSessionExchange {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  user: { id: string; email: string; name?: string | null };
  organization: { id: string; slug: string; name: string };
  default_personal_vk?: { id?: string; secret?: string; prefix?: string };
  personal_project?: {
    id: string;
    slug: string;
    name: string;
    api_key?: string;
  };
  cli_api_key?: string;
  cli_api_key_scope?: {
    kind: "organization" | "projects";
    project_ids?: string[];
    permissions?: string[];
  };
  endpoint?: string;
}

async function postCliAuth<T>({
  route,
  body,
  cookie,
}: {
  route: string;
  body: Record<string, unknown>;
  cookie?: string;
}): Promise<T> {
  const response = await fetch(`${APP_BASE}/api/auth/cli/${route}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(cookie === undefined ? {} : { Cookie: cookie }),
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    throw new Error(
      `/api/auth/cli/${route} answered ${response.status}: ${(await response.text()).slice(0, 300)}`,
    );
  }
  return (await response.json()) as T;
}

/**
 * Signs the command line in the way `langwatch login --device` does, as
 * the test's own user (README.md "local-control-fixture.ts").
 */
export async function writeCliLoginConfig({ configPath }: { configPath: string }): Promise<void> {
  const cookie = await getSessionCookie();
  const organizationId = await organizationIdOfProject(cookie);
  const code = await postCliAuth<{ device_code: string; user_code: string }>({
    route: "device-code",
    body: { credential_type: "device_session" },
  });
  await postCliAuth<unknown>({
    route: "approve",
    body: { user_code: code.user_code, organization_id: organizationId },
    cookie,
  });
  const result = await postCliAuth<DeviceSessionExchange>({
    route: "exchange",
    body: { device_code: code.device_code },
  });
  const now = Math.floor(Date.now() / 1000);
  const config = {
    gateway_url: process.env.LANGWATCH_GATEWAY_URL ?? "http://localhost:5563",
    control_plane_url: result.endpoint ?? APP_BASE,
    access_token: result.access_token,
    refresh_token: result.refresh_token,
    expires_at: now + result.expires_in,
    user: {
      id: result.user.id,
      email: result.user.email,
      name: result.user.name,
    },
    organization: {
      id: result.organization.id,
      slug: result.organization.slug,
      name: result.organization.name,
    },
    ...(result.default_personal_vk ? { default_personal_vk: result.default_personal_vk } : {}),
    ...(result.personal_project?.api_key
      ? {
          personal_project: {
            id: result.personal_project.id,
            slug: result.personal_project.slug,
            name: result.personal_project.name,
            api_key: result.personal_project.api_key,
            validated_at: now,
          },
        }
      : {}),
    ...(result.cli_api_key
      ? {
          cli_api_key: result.cli_api_key,
          ...(result.cli_api_key_scope
            ? {
                cli_api_key_scope: {
                  kind: result.cli_api_key_scope.kind,
                  project_ids: result.cli_api_key_scope.project_ids ?? [],
                  ...(Array.isArray(result.cli_api_key_scope.permissions)
                    ? { permissions: result.cli_api_key_scope.permissions }
                    : {}),
                },
              }
            : {}),
        }
      : {}),
  };
  await fs.mkdir(path.dirname(configPath), { recursive: true, mode: 0o700 });
  await fs.writeFile(configPath, JSON.stringify(config, null, 2), {
    encoding: "utf8",
    mode: 0o600,
  });
}

/**
 * A user-scoped API key for the test's own user, bound to the test
 * project, minted and read back to catch a slow-to-propagate binding
 * (README.md "local-control-fixture.ts").
 */
export function getCliApiKey(): Promise<string> {
  cliApiKeyPromise ??= (async () => {
    try {
      const cookie = await getSessionCookie();
      const organizationId = await organizationIdOfProject(cookie);
      let refusal = "";
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const created = await trpcMutate<{ token: string }>({
          cookie,
          path: "apiKey.create",
          input: {
            organizationId,
            name: `langy-local-control-e2e ${new Date().toISOString()}`,
            keyType: "personal",
            permissionMode: "all",
            bindings: [{ role: "ADMIN", scopeType: "PROJECT", scopeId: CONFIG.PROJECT_ID }],
          },
        });
        refusal = await keyRefusal(created.token);
        if (refusal === "") return created.token;
        console.log(`[fixture] minted key refused, minting again: ${refusal}`);
        // A key minted seconds after the app booted is refused for
        // `langy:view` until the permission read catches up, and three mints
        // in the same second all land inside that window.
        await sleep(3_000 * (attempt + 1));
      }
      throw new Error(`every minted key was refused by the control route: ${refusal}`);
    } catch (error) {
      cliApiKeyPromise = null;
      throw error;
    }
  })();
  return cliApiKeyPromise;
}

/**
 * Empty when the key reaches the control route, otherwise the words the
 * platform refused it with. The list read needs the same permission the
 * command line needs, so it is the cheapest proof the key carries it.
 */
async function keyRefusal(token: string): Promise<string> {
  try {
    const response = await fetch(`${APP_BASE}/api/v1/langy/control/requests`, {
      headers: { "X-Auth-Token": token, "X-Project-Id": CONFIG.PROJECT_ID },
      signal: AbortSignal.timeout(30_000),
    });
    if (response.ok) return "";
    return `${response.status} ${(await response.text()).slice(0, 200)}`;
  } catch (error) {
    return String(error);
  }
}

// ---------------------------------------------------------------------------
// The temporary repository
// ---------------------------------------------------------------------------

/** The repository the scenario shares, and the reads the assertions make. */
export interface DemoRepo {
  root: string;
  language: DemoLanguage;
  /** Every local branch name. */
  branches: () => string[];
  /** The branch that is checked out. */
  currentBranch: () => string;
  /** The subject line of every commit, newest first. */
  log: () => string[];
  /** The diff of one branch against `main`. */
  diffAgainstMain: (branch: string) => string;
  /** The porcelain status, so a test can prove the tree was left clean. */
  status: () => string;
  read: (relativePath: string) => string;
  exists: (relativePath: string) => boolean;
  /** The bare repository `origin` points at, beside the working copy. */
  remote: string;
  /** Every branch that reached the remote, so a push is a fact and not a claim. */
  remoteBranches: () => string[];
  /** Any git command, for a read a helper above does not cover. */
  git: (args: string[]) => string;
}

async function copyTree(from: string, to: string): Promise<void> {
  await fs.mkdir(to, { recursive: true });
  for (const entry of await fs.readdir(from, { withFileTypes: true })) {
    if (SKIPPED_ENTRIES.has(entry.name)) continue;
    const source = path.join(from, entry.name);
    const target = path.join(to, entry.name);
    if (entry.isDirectory()) {
      await copyTree(source, target);
    } else if (entry.isSymbolicLink()) {
      await fs.symlink(await fs.readlink(source), target);
    } else {
      await fs.copyFile(source, target);
    }
  }
}

/**
 * Points the demo's LangWatch SDK dependency at this checkout by absolute
 * path (README.md "local-control-fixture.ts").
 */
async function pointSdkAtThisCheckout({
  root,
  language,
}: {
  root: string;
  language: DemoLanguage;
}): Promise<void> {
  if (DEMO[language].runtime === "uv") {
    const file = path.join(root, "pyproject.toml");
    const source = await fs.readFile(file, "utf8");
    await fs.writeFile(
      file,
      source.replace(
        /path\s*=\s*"[^"]*sdks\/python"/,
        `path = "${path.join(REPO_ROOT, "sdks", "python")}"`,
      ),
      "utf8",
    );
    return;
  }
  const file = path.join(root, "package.json");
  const manifest = JSON.parse(await fs.readFile(file, "utf8")) as {
    dependencies?: Record<string, string>;
  };
  if (manifest.dependencies?.langwatch) {
    manifest.dependencies.langwatch = `file:${path.join(REPO_ROOT, "sdks", "typescript")}`;
  }
  await fs.writeFile(file, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}

/** How many finished runs keep their folder on disk. */
const DEMO_REPOS_KEPT = 4;

/** The folders to delete, newest kept (README.md "local-control-fixture.ts"). */
export function demoReposToPrune({
  existing,
  keep = DEMO_REPOS_KEPT,
}: {
  /** Folder names, as they were made: `<name>-<base36 timestamp>`. */
  existing: readonly string[];
  keep?: number;
}): string[] {
  const stamped = existing
    .map((folder) => {
      const stamp = Number.parseInt(folder.slice(folder.lastIndexOf("-") + 1), 36);
      return { folder, stamp: Number.isNaN(stamp) ? 0 : stamp };
    })
    .toSorted((a, b) => b.stamp - a.stamp);
  return stamped.slice(Math.max(0, keep)).map((entry) => entry.folder);
}

/** Delete every demo repository but the most recent few, remotes included. */
async function pruneDemoRepos(): Promise<void> {
  const entries = await fs.readdir(SCENARIO_REPO_DIR, { withFileTypes: true }).catch(() => []);
  const folders = entries
    .filter((entry) => entry.isDirectory() && !entry.name.endsWith(".git"))
    .map((entry) => entry.name);
  for (const folder of demoReposToPrune({ existing: folders })) {
    for (const target of [folder, `${folder}.git`]) {
      await fs.rm(path.join(SCENARIO_REPO_DIR, target), {
        recursive: true,
        force: true,
      });
    }
  }
}

/** A demo app as its own git repo, one commit (README.md "local-control-fixture.ts"). */
export async function createDemoRepo({
  language,
  name,
  install = true,
}: {
  language: DemoLanguage;
  /** Names the folder, so a failed run is readable on disk. */
  name: string;
  install?: boolean;
}): Promise<DemoRepo> {
  await pruneDemoRepos();
  const root = path.join(SCENARIO_REPO_DIR, `${name}-${Date.now().toString(36)}`);
  await fs.rm(root, { recursive: true, force: true });
  await copyTree(DEMO[language].dir, root);
  await pointSdkAtThisCheckout({ root, language });

  const git = (args: string[]): string => sh("git", args, { cwd: root });
  git(["init", "--initial-branch=main"]);
  git(["config", "user.name", "LangWatch scenario"]);
  git(["config", "user.email", "scenario@langwatch.localhost"]);
  git(["config", "commit.gpgsign", "false"]);
  git(["add", "-A"]);
  git(["commit", "-m", DEMO[language].commit]);

  // A repository with no remote makes `git push` exit 128, and the pull
  // request path can then never finish in a scenario. A bare repository beside
  // the working copy is a remote that behaves like one, without a network and
  // without a GitHub account. `gh pr create` still cannot run against it,
  // which is the part the scenarios already tolerate.
  const remote = `${root}.git`;
  await fs.rm(remote, { recursive: true, force: true });
  sh("git", ["init", "--bare", "--initial-branch=main", remote]);
  git(["remote", "add", "origin", remote]);
  git(["push", "-u", "origin", "main"]);

  if (install) {
    if (DEMO[language].runtime === "uv") {
      sh("uv", ["sync"], { cwd: root, timeoutMs: 600_000 });
    } else {
      sh("npm", ["install", "--no-audit", "--no-fund"], {
        cwd: root,
        timeoutMs: 600_000,
      });
    }
  }

  return {
    root,
    language,
    branches: () =>
      git(["for-each-ref", "--format=%(refname:short)", "refs/heads"])
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean),
    currentBranch: () => git(["rev-parse", "--abbrev-ref", "HEAD"]).trim(),
    log: () =>
      git(["log", "--all", "--pretty=%s"])
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean),
    diffAgainstMain: (branch: string) => git(["diff", `main...${branch}`]),
    status: () => git(["status", "--porcelain"]),
    read: (relativePath: string) =>
      existsSync(path.join(root, relativePath))
        ? readFileSync(path.join(root, relativePath), "utf8")
        : "",
    exists: (relativePath: string) => existsSync(path.join(root, relativePath)),
    remote,
    remoteBranches: () =>
      sh("git", ["for-each-ref", "--format=%(refname:short)", "refs/heads"], {
        cwd: remote,
      })
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean),
    git,
  };
}

/** Folders a scenario can share that are NOT a demo app (README.md "local-control-fixture.ts"). */
export type FixtureFolderName = "acme-notes";

const FIXTURE_FOLDER: Record<FixtureFolderName, string> = {
  "acme-notes": path.join(REPO_ROOT, "dev", "dogfood", "acme-notes", "python"),
};

/** A shared folder that is not a demo repository, and what a test reads of it. */
export interface FixtureFolder {
  root: string;
  /** Whether a repository exists in it, which a scenario can be about. */
  isGitRepo: () => boolean;
  read: (relativePath: string) => string;
  exists: (relativePath: string) => boolean;
  /** Any git command. Answers "" while there is no repository. */
  git: (args: string[]) => string;
  /** Every local branch name, empty while there is no repository. */
  branches: () => string[];
  /** The subject line of every commit, newest first. */
  log: () => string[];
  /** The porcelain status, empty while there is no repository. */
  status: () => string;
}

/**
 * Copies a fixture folder somewhere temporary. Nothing is installed
 * (README.md "local-control-fixture.ts").
 */
export async function createFixtureFolder({
  fixture,
  name,
  git: withGit,
}: {
  fixture: FixtureFolderName;
  /** Names the folder, so a failed run is readable on disk. */
  name: string;
  git: boolean;
}): Promise<FixtureFolder> {
  await pruneDemoRepos();
  const root = path.join(SCENARIO_REPO_DIR, `${name}-${Date.now().toString(36)}`);
  await fs.rm(root, { recursive: true, force: true });
  await copyTree(FIXTURE_FOLDER[fixture], root);

  const git = (args: string[]): string => {
    try {
      return sh("git", args, { cwd: root });
    } catch {
      return "";
    }
  };
  if (withGit) {
    git(["init", "--initial-branch=main"]);
    git(["config", "user.name", "LangWatch scenario"]);
    git(["config", "user.email", "scenario@langwatch.localhost"]);
    git(["config", "commit.gpgsign", "false"]);
    git(["add", "-A"]);
    git(["commit", "-m", `chore: the ${fixture} application`]);
  }

  return {
    root,
    isGitRepo: () => existsSync(path.join(root, ".git")),
    read: (relativePath: string) =>
      existsSync(path.join(root, relativePath))
        ? readFileSync(path.join(root, relativePath), "utf8")
        : "",
    exists: (relativePath: string) => existsSync(path.join(root, relativePath)),
    git,
    branches: () =>
      git(["for-each-ref", "--format=%(refname:short)", "refs/heads"])
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean),
    log: () =>
      git(["log", "--all", "--pretty=%s"])
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean),
    status: () => git(["status", "--porcelain"]),
  };
}

/** The newest interpreter here the SDK supports (README.md "local-control-fixture.ts"). */
function supportedPython(): string {
  for (const name of ["python3.13", "python3.12", "python3"]) {
    const found = spawnSync("which", [name], { encoding: "utf8" });
    if (found.status === 0 && found.stdout.trim()) {
      return realPython(found.stdout.trim());
    }
  }
  return "python3";
}

/** Resolves the symlink `which` answered (README.md "local-control-fixture.ts"). */
function realPython(candidate: string): string {
  try {
    return realpathSync(candidate);
  } catch {
    return candidate;
  }
}

/** A Python interpreter of a scenario's own, and the ways it uses one. */
export interface PythonEnv {
  /** Goes on the terminal's PATH: it carries `python3`, `pip3` and `pip`. */
  binDir: string;
  /** The interpreter itself, for a test that asserts on what got installed. */
  python: string;
  /** Its `major.minor`, for a scenario whose premise is the version. */
  version: string;
  /** Whether the interpreter can import a module, which an install proves. */
  canImport: (module: string) => boolean;
}

/**
 * Builds a Python interpreter beside the shared folder, never in it
 * (README.md "local-control-fixture.ts").
 */
export async function createPythonEnv({
  at,
  forFolder,
  interpreter = "supported",
}: {
  at: string;
  forFolder?: string;
  /** `supported`/`machine-default` (README.md "local-control-fixture.ts"). */
  interpreter?: "supported" | "machine-default";
}): Promise<PythonEnv> {
  await fs.rm(at, { recursive: true, force: true });
  const base = interpreter === "supported" ? supportedPython() : "python3";
  sh(base, ["-m", "venv", at], { timeoutMs: 300_000 });
  const binDir = path.join(at, "bin");
  const python = path.join(binDir, "python3");
  const requirements = forFolder && path.join(forFolder, "requirements.txt");
  if (requirements && existsSync(requirements)) {
    sh(python, ["-m", "pip", "install", "-r", requirements], {
      timeoutMs: 600_000,
    });
  }
  return {
    binDir,
    python,
    version: sh(python, ["-c", "import sys; print('%d.%d' % sys.version_info[:2])"], {
      timeoutMs: 120_000,
    }).trim(),
    canImport: (module: string) => {
      try {
        sh(python, ["-c", `import ${module}`], { timeoutMs: 120_000 });
        return true;
      } catch {
        return false;
      }
    },
  };
}

// ---------------------------------------------------------------------------
// The command line, in a terminal
// ---------------------------------------------------------------------------

/** Where the built command line lives once the SDK is bundled. */
const CLI_ENTRY = path.join(REPO_ROOT, "sdks", "typescript", "dist", "cli", "index.js");

let cliBuildPromise: Promise<void> | null = null;

/** Builds the command line once per test process (README.md "local-control-fixture.ts"). */
export function buildCli(): Promise<void> {
  cliBuildPromise ??= (async () => {
    try {
      if (process.env.LANGY_SKIP_CLI_BUILD === "1" && existsSync(CLI_ENTRY)) {
        return;
      }
      sh("pnpm", ["--filter", "langwatch", "exec", "tsup"], {
        cwd: REPO_ROOT,
        timeoutMs: 600_000,
      });
      if (!existsSync(CLI_ENTRY)) {
        throw new Error(`the CLI build produced no ${CLI_ENTRY}`);
      }
    } catch (error) {
      cliBuildPromise = null;
      throw error;
    }
  })();
  return cliBuildPromise;
}

/**
 * A directory of stand-in commands for the terminal's PATH. Each body runs
 * under `/bin/sh` with the call's own arguments, so a stand-in can refuse
 * (`exit 127`), answer something fixed, or hand the call on.
 */
async function shimBinDir(at: string, shims: Record<string, string>): Promise<string> {
  await fs.mkdir(at, { recursive: true });
  for (const [name, body] of Object.entries(shims)) {
    await fs.writeFile(path.join(at, name), `#!/bin/sh\n${body}\n`, {
      encoding: "utf8",
      mode: 0o755,
    });
  }
  return at;
}

/** A `langwatch` shim on PATH for this branch's build (README.md "local-control-fixture.ts"). */
async function cliBinDir(at: string): Promise<string> {
  await fs.mkdir(at, { recursive: true });
  const shim = path.join(at, "langwatch");
  await fs.writeFile(shim, `#!/bin/sh\nexec node ${JSON.stringify(CLI_ENTRY)} "$@"\n`, {
    encoding: "utf8",
    mode: 0o755,
  });
  return at;
}

/** The terminal the command line runs in, and the ways a test drives it. */
export interface CliTerminal {
  sessionName: string;
  /** Everything the terminal has shown so far. */
  capture: () => string;
  /** Wait until the terminal shows this text, then answer with the capture. */
  waitForText: (pattern: string | RegExp, timeoutMs?: number) => Promise<string>;
  sendKeys: (...keys: string[]) => void;
  /** Wait for the approve question and answer it with Approve. */
  approve: (timeoutMs?: number) => Promise<void>;
  /** Answers the next permission ask, default option (README.md "local-control-fixture.ts"). */
  answerNextPermission: (
    timeoutMs?: number,
    /** Waits for the box asking about THIS command (README.md "local-control-fixture.ts"). */
    command?: RegExp,
  ) => Promise<string>;
  /** Ctrl-C twice, which is how a developer stops sharing. */
  disconnect: () => Promise<void>;
  isRunning: () => boolean;
  /** Kill the terminal whatever state it is in. */
  stop: () => void;
}

/** Cancels every open control request for this project (README.md "local-control-fixture.ts"). */
export async function cancelOpenControlRequests(): Promise<void> {
  const apiKey = await getCliApiKey();
  const headers = {
    "X-Auth-Token": apiKey,
    "X-Project-Id": CONFIG.PROJECT_ID,
    "Content-Type": "application/json",
  };
  const listed = await fetch(`${APP_BASE}/api/v1/langy/control/requests`, {
    headers,
    signal: AbortSignal.timeout(30_000),
  });
  if (!listed.ok) return;
  const body = (await listed.json()) as { requests?: { id: string }[] };
  for (const request of body.requests ?? []) {
    await fetch(
      `${APP_BASE}/api/v1/langy/control/requests/${encodeURIComponent(request.id)}/cancel`,
      { method: "POST", headers, signal: AbortSignal.timeout(30_000) },
    ).catch(() => undefined);
  }
}

/**
 * Starts `langwatch langy --share-control` in the folder, its own
 * terminal — waits when no request is open, so start order never matters.
 */
/** A running share-control terminal's identity (README.md "local-control-fixture.ts"). */
interface ShareControlSession {
  sessionName: string;
  paneLog: string;
}

function readShareControlPaneLog(session: ShareControlSession): string {
  try {
    return readFileSync(session.paneLog, "utf8");
  } catch {
    return "";
  }
}

/** The live pane while there, else the log (README.md "local-control-fixture.ts"). */
function captureShareControlTerminal(session: ShareControlSession): string {
  const result = spawnSync(
    "tmux",
    ["capture-pane", "-p", "-t", session.sessionName, "-S", "-3000"],
    { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 },
  );
  const pane = result.stdout ?? "";
  const logged = readShareControlPaneLog(session);
  if (pane.trim() === "") return logged;
  return logged.includes("Leaving") ? `${pane}\n${logged}` : pane;
}

function isShareControlRunning(session: ShareControlSession): boolean {
  return spawnSync("tmux", ["has-session", "-t", session.sessionName]).status === 0;
}

function sendShareControlKeys(session: ShareControlSession, ...keys: string[]): void {
  spawnSync("tmux", ["send-keys", "-t", session.sessionName, ...keys]);
}

async function waitForShareControlText(
  session: ShareControlSession,
  pattern: string | RegExp,
  timeoutMs = 120_000,
): Promise<string> {
  return waitFor({
    what: `the terminal to show ${String(pattern)}`,
    timeoutMs,
    intervalMs: 750,
    read: () => {
      const text = captureShareControlTerminal(session);
      const seen = typeof pattern === "string" ? text.includes(pattern) : pattern.test(text);
      return seen ? text : null;
    },
  });
}

/** The approve question, whichever shape it is drawn in (README.md "local-control-fixture.ts"). */
async function approveShareControl(
  session: ShareControlSession,
  timeoutMs = 240_000,
): Promise<void> {
  await waitForShareControlText(session, /share this folder\?/i, timeoutMs);
  // The picker opens on Approve, so Enter is the whole answer. A short
  // pause first: the prompt paints before it listens.
  await sleep(500);
  sendShareControlKeys(session, "Enter");
  await waitForShareControlText(session, "Connected", 60_000);
}

/** The next permission box, read off the screen (README.md "local-control-fixture.ts"). */
async function answerNextShareControlPermission(
  session: ShareControlSession,
  timeoutMs = 300_000,
  command?: RegExp,
): Promise<string> {
  await waitFor({
    what: command
      ? `the terminal to ask about ${String(command)}`
      : "the terminal to ask for permission",
    timeoutMs,
    intervalMs: 500,
    read: () => {
      const box = captureShareControlTerminal(session).split("\n").slice(-30).join("\n");
      if (!box.includes("Do you want to allow this?")) return null;
      if (command && !command.test(box)) return null;
      return box;
    },
  });
  // The selector paints before it listens, the way the approve prompt does.
  await sleep(500);
  sendShareControlKeys(session, "Enter");
  return waitForShareControlText(session, /Allowed |Denied/, 60_000);
}

/** Ctrl-C twice, the way a developer stops sharing (README.md "local-control-fixture.ts"). */
async function disconnectShareControl(session: ShareControlSession): Promise<void> {
  if (!isShareControlRunning(session)) return;
  sendShareControlKeys(session, "C-c");
  await sleep(1_500);
  if (isShareControlRunning(session)) sendShareControlKeys(session, "C-c");
  await waitFor({
    what: "the command line to exit",
    timeoutMs: 30_000,
    intervalMs: 500,
    read: () => !isShareControlRunning(session),
  }).catch(() => undefined);
}

export async function startShareControl({
  repo,
  label,
  clearOpenRequests = true,
  shims = {},
  pathDirs = [],
}: {
  repo: Pick<DemoRepo, "root">;
  label: string;
  /** Cancel already-open requests first (README.md "local-control-fixture.ts"). */
  clearOpenRequests?: boolean;
  /** Commands FIRST on the terminal's PATH (README.md "local-control-fixture.ts"). */
  shims?: Record<string, string>;
  /** Dirs on PATH after the shims (README.md "local-control-fixture.ts"). */
  pathDirs?: string[];
}): Promise<CliTerminal> {
  await buildCli();
  if (clearOpenRequests) await cancelOpenControlRequests();
  const sessionName = `langy-${label}-${Date.now().toString(36)}`;
  const configPath = path.join(repo.root, "..", `${sessionName}-config.json`);
  await writeCliLoginConfig({ configPath });
  const binDir = await cliBinDir(path.join(repo.root, "..", `${sessionName}-bin`));
  const shimDir = await shimBinDir(path.join(repo.root, "..", `${sessionName}-shims`), shims);
  const script = path.join(repo.root, "..", `${sessionName}.sh`);
  // The terminal signs in through the login config alone, which is the one
  // credential the command takes: a control request is addressed to the
  // person.
  await fs.writeFile(
    script,
    shareControlProfile({
      root: repo.root,
      configPath,
      binDir,
      shimDir,
      pathDirs,
    }),
    { encoding: "utf8", mode: 0o755 },
  );

  sh("tmux", ["new-session", "-d", "-s", sessionName, "-x", "200", "-y", "60", "bash", script]);

  // Everything printed, kept on disk (README.md "local-control-fixture.ts").
  const paneLog = path.join(repo.root, "..", `${sessionName}.log`);
  sh("tmux", ["pipe-pane", "-o", "-t", sessionName, `cat >> ${JSON.stringify(paneLog)}`]);

  const session: ShareControlSession = { sessionName, paneLog };
  const terminal: CliTerminal = {
    sessionName,
    capture: () => captureShareControlTerminal(session),
    waitForText: (pattern, timeoutMs) => waitForShareControlText(session, pattern, timeoutMs),
    sendKeys: (...keys) => sendShareControlKeys(session, ...keys),
    approve: (timeoutMs) => approveShareControl(session, timeoutMs),
    answerNextPermission: (timeoutMs, command) =>
      answerNextShareControlPermission(session, timeoutMs, command),
    disconnect: () => disconnectShareControl(session),
    isRunning: () => isShareControlRunning(session),
    stop: () => {
      spawnSync("tmux", ["kill-session", "-t", sessionName]);
    },
  };
  await terminal.waitForText(/Waiting for a Langy conversation|share this folder\?/i, 120_000);
  return terminal;
}

// ---------------------------------------------------------------------------
// Answering the cards as the user
// ---------------------------------------------------------------------------

/** One permission card the panel showed, and what the fixture answered. */
export interface PermissionAsk {
  waitId: string;
  callId: string;
  summary: string;
  pattern: string;
  reason: string;
  skipOffered: boolean;
  decision: "allow_once" | "allow_pattern" | "deny";
  /** Where the developer answered it. */
  answeredIn: "panel" | "terminal";
  turnId: string;
  askedAt: number;
}

/** One question card the panel showed, and what the fixture answered. */
export interface QuestionAsk {
  waitId: string;
  questions: {
    question: string;
    options?: { label: string; quiet?: boolean }[];
  }[];
  answered: { question: string; selected: string[] }[];
  turnId: string;
}

/** How the fixture answers permission cards, in the order it reads the rules. */
export interface PermissionPolicy {
  /** Deny a card whose summary matches one of these. */
  deny?: RegExp[];
  /** Answer "allow for this session" for a card whose summary matches. */
  allowPattern?: RegExp[];
  /** Everything else. */
  fallback?: "allow_once" | "deny";
}

/** Picks the answer to one question card, default first (README.md "local-control-fixture.ts"). */
export type QuestionAnswerPicker = (question: {
  question: string;
  options?: { label: string; quiet?: boolean }[];
}) => string[] | Promise<string[]>;

/** One message in the shape the scenario judge reads. */
export type JudgeMessage =
  | { role: "assistant"; content: string }
  | {
      role: "assistant";
      content: (
        | { type: "text"; text: string }
        | {
            type: "tool-call";
            toolCallId: string;
            toolName: string;
            input: unknown;
          }
      )[];
    }
  | {
      role: "tool";
      content: {
        type: "tool-result";
        toolCallId: string;
        toolName: string;
        output: { type: "text" | "error-text"; value: string };
      }[];
    };

/** What the watcher saw on the conversation, and what it answered. */
export interface ConversationWatcher {
  permissions: PermissionAsk[];
  questions: QuestionAsk[];
  /** Answers since the last drain, one line each (README.md "local-control-fixture.ts"). */
  drainAnswerNotes: () => string[];
  /** Leaves the next matching card to the terminal (README.md "local-control-fixture.ts"). */
  leaveNextPermissionToTerminal: (match: RegExp) => void;
  /** `connected` and `disconnected` entries, in order. */
  workspaceEvents: { state: string; name: string; root: string }[];
  /** Every `navigate` instruction on followed turns (README.md "local-control-fixture.ts"). */
  navigateHrefs: string[];
  /** Every tool frame, followed turns, in order (README.md "local-control-fixture.ts"). */
  toolEvents: LangyToolEvent[];
  /** Every turn the watcher observed, in the order it observed them. */
  turnIds: string[];
  /** The turns the panel started on its own, without a message from the test. */
  turnsStartedWithoutUs: (knownTurnIds: string[]) => string[];
  /** Wait for a turn other than the ones already known. */
  waitForNewTurn: (input: { knownTurnIds: string[]; timeoutMs?: number }) => Promise<string>;
  /** Whether the card answered inside the turn's call (README.md "local-control-fixture.ts"). */
  cardAnsweredInsideTurn: (input: { turnId: string }) => Promise<boolean>;
  /** Waits until no turn is in flight (README.md "local-control-fixture.ts"). */
  waitForIdle: (timeoutMs?: number) => Promise<void>;
  /** The whole conversation, as the panel would render it. */
  transcript: () => Promise<string>;
  /** One turn's answer, or the last stored when none named. */
  lastAssistantText: (input?: { turnId?: string; timeoutMs?: number }) => Promise<string>;
  /** One turn's answer as a judge reads it (README.md "local-control-fixture.ts"). */
  lastTurnMessages: (input?: { turnId?: string; timeoutMs?: number }) => Promise<JudgeMessage[]>;
  stop: () => void;
}

/** One message of the stored conversation, as `langy.messages` returns it. */
export interface StoredMessage {
  id: string;
  role: string;
  parts: Record<string, unknown>[];
}

/** The words one stored part carries, or null (README.md "local-control-fixture.ts"). */
export function partProse(part: Record<string, unknown>): string | null {
  const said =
    part.type === "tool-say" ? (part.input as { text?: unknown } | undefined)?.text : part.text;
  return typeof said === "string" && said.trim() !== "" ? said : null;
}

/** What one settled tool call returned (README.md "local-control-fixture.ts"). */
export function toolOutputText(part: Record<string, unknown>): string {
  if (part.state === "output-error" && typeof part.errorText === "string") {
    return part.errorText;
  }
  return typeof part.output === "string" ? part.output : JSON.stringify(part.output ?? "");
}

/** Whether one stored part is a tool call rather than something Langy wrote. */
export function isToolCallPart(part: Record<string, unknown>): boolean {
  return (
    typeof part.type === "string" &&
    part.type.startsWith("tool-") &&
    part.type !== "tool-say" &&
    typeof part.toolCallId === "string"
  );
}

/** Everything a stored message says, panel order (README.md "local-control-fixture.ts"). */
export function storedProse(parts: Record<string, unknown>[]): string {
  return storedPassages(parts).join("\n");
}

/** The same lines, one passage per `say` (README.md "local-control-fixture.ts"). */
export function storedPassages(parts: Record<string, unknown>[]): string[] {
  const said: string[] = [];
  for (const part of parts) {
    const text = partProse(part);
    if (text === null || text.trim() === said[said.length - 1]?.trim()) {
      continue;
    }
    said.push(text);
  }
  return said;
}

/** One stored message as the judge reads it (README.md "local-control-fixture.ts"). */
/** The fold `foldJudgePart` accumulates into (README.md "local-control-fixture.ts"). */
interface JudgeFoldState {
  narration: string[];
  batch: Record<string, unknown>[];
}

/** One part's effect on the fold: opens the next stretch, or joins the batch. */
function foldJudgePart(
  part: Record<string, unknown>,
  state: JudgeFoldState,
  flush: () => void,
): void {
  const said = partProse(part);
  if (said !== null) {
    if (state.batch.length > 0) flush();
    if (said.trim() !== state.narration[state.narration.length - 1]?.trim()) {
      state.narration.push(said);
    }
    return;
  }
  if (isToolCallPart(part)) {
    state.batch.push(part);
  }
}

export function judgeMessages(message: {
  role: string;
  parts: Record<string, unknown>[];
}): JudgeMessage[] {
  const messages: JudgeMessage[] = [];
  const state: JudgeFoldState = { narration: [], batch: [] };

  const flush = () => {
    if (state.batch.length === 0 && state.narration.length === 0) return;
    messages.push({
      role: "assistant",
      content: [
        ...state.narration.map((text) => ({ type: "text" as const, text })),
        ...state.batch.map((part) => ({
          type: "tool-call" as const,
          toolCallId: String(part.toolCallId),
          toolName: String(part.type).slice("tool-".length),
          input: part.input,
        })),
      ],
    });
    if (state.batch.length > 0) {
      messages.push({
        role: "tool",
        content: state.batch.map((part) => ({
          type: "tool-result" as const,
          toolCallId: String(part.toolCallId),
          toolName: String(part.type).slice("tool-".length),
          output: {
            type: part.state === "output-error" ? ("error-text" as const) : ("text" as const),
            value: toolOutputText(part),
          },
        })),
      });
    }
    state.narration = [];
    state.batch = [];
  };

  for (const part of message.parts) foldJudgePart(part, state, flush);
  flush();

  // The turn's reply is the line it ended on, on its own (README.md "local-control-fixture.ts").
  const passages = storedPassages(message.parts);
  messages.push({
    role: "assistant",
    content: passages[passages.length - 1] ?? "",
  });
  return messages;
}

/** The shell profile the shared terminal starts from (README.md "local-control-fixture.ts"). */
export function shareControlProfile({
  root,
  configPath,
  binDir,
  shimDir,
  pathDirs = [],
  ceiling = SCENARIO_REPO_DIR,
  appBase = APP_BASE,
  cliEntry = CLI_ENTRY,
}: {
  root: string;
  configPath: string;
  binDir: string;
  shimDir: string;
  pathDirs?: string[];
  ceiling?: string;
  appBase?: string;
  cliEntry?: string;
}): string {
  return [
    "#!/bin/bash",
    `cd ${JSON.stringify(root)}`,
    "unset LANGWATCH_API_KEY",
    `export LANGWATCH_ENDPOINT=${JSON.stringify(appBase)}`,
    `export LANGWATCH_CLI_CONFIG=${JSON.stringify(configPath)}`,
    // PATH order (README.md "local-control-fixture.ts").
    `export PATH=${[shimDir, binDir, ...pathDirs]
      .map((dir) => JSON.stringify(dir))
      .join(":")}:"$PATH"`,
    "export FORCE_COLOR=0",
    "unset TRACEPARENT",
    // Stops git's upward walk at the scenario folders (README.md "local-control-fixture.ts").
    `export GIT_CEILING_DIRECTORIES=${JSON.stringify(ceiling)}`,
    `exec node ${JSON.stringify(cliEntry)} langy --share-control`,
    "",
  ].join("\n");
}

/** The stored answer of one turn (README.md "local-control-fixture.ts"). */
export function answerOfTurn(messages: StoredMessage[], turnId: string): StoredMessage | null {
  return (
    messages.find((message) => message.role === "assistant" && message.id.endsWith(turnId)) ?? null
  );
}

/** What the developer answered on a permission card (README.md "local-control-fixture.ts"). */
export function permissionAnswerNote(ask: PermissionAsk): string {
  const where = ask.answeredIn === "terminal" ? "in the terminal" : "in the panel";
  if (ask.decision === "deny") {
    return `[developer denied ${where}: ${ask.summary}]`;
  }
  if (ask.decision === "allow_pattern") {
    const pattern = ask.pattern || ask.summary;
    return `[developer allowed the pattern \`${pattern}\` for this session ${where}: ${ask.summary}]`;
  }
  return `[developer allowed once ${where}: ${ask.summary}]`;
}

/** What a scenario is told when the turn to grade failed (README.md "local-control-fixture.ts"). */
export function turnFailureMessage({
  turnId,
  failure,
}: {
  turnId?: string;
  failure: string;
}): string {
  const named = turnId ? `Turn ${turnId}` : "The last turn";
  return `${named} failed, so there is no answer to grade: ${failure}`;
}

/** The line that says what the developer answered on a question card. */
export function questionAnswerNote(ask: QuestionAsk): string {
  const answers = ask.answered
    .map((answer) => `"${answer.question}" -> ${answer.selected.join(", ")}`)
    .join("; ");
  return `[developer answered in the panel: ${answers}]`;
}

/** An `unknown` stream/record field as a string, never Object's default. */
function stringField(value: unknown): string {
  if (typeof value === "string") return value;
  if (value == null) return "";
  return JSON.stringify(value);
}

interface StreamEntry {
  type?: string;
  [key: string]: unknown;
}

/** One card as the conversation's durable record holds it. */
export interface RecordWait {
  waitId: string;
  kind: string;
  status: string;
  turnId: string;
  [key: string]: unknown;
}

/** Cards on the record still needing an answer (README.md "local-control-fixture.ts"). */
export function pendingWaitDispatches({
  waits,
  answered,
}: {
  waits: RecordWait[];
  answered: ReadonlySet<string>;
}): { entry: StreamEntry; turnId: string; kind: string }[] {
  const dispatches: {
    entry: StreamEntry;
    turnId: string;
    kind: string;
  }[] = [];
  for (const wait of waits) {
    if (!wait.waitId || wait.status !== "pending") continue;
    if (answered.has(wait.waitId)) continue;
    dispatches.push({
      entry: wait as StreamEntry,
      turnId: wait.turnId,
      kind: wait.kind,
    });
  }
  return dispatches;
}

/** One turn's live stream, reported (README.md "local-control-fixture.ts"). */
/** One raw SSE frame's lines, dispatched to `onEntry` (README.md "local-control-fixture.ts"). */
function dispatchTurnFrame(frame: string, onEntry: (entry: StreamEntry) => void): void {
  for (const line of frame.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data:")) continue;
    const payload = trimmed.slice(5).trim();
    if (!payload) continue;
    try {
      const entry = JSON.parse(payload).json as StreamEntry;
      if (entry && typeof entry === "object") onEntry(entry);
    } catch (error) {
      // A frame the suite does not understand is not this suite's business.
      console.debug(`[fixture] unparsed stream frame: ${String(error)}`);
    }
  }
}

async function readTurnEntries({
  cookie,
  conversationId,
  turnId,
  onEntry,
  signal,
}: {
  cookie: string;
  conversationId: string;
  turnId: string;
  onEntry: (entry: StreamEntry) => void;
  signal: AbortSignal;
}): Promise<void> {
  const input = encodeURIComponent(
    JSON.stringify({ json: { projectId: CONFIG.PROJECT_ID, conversationId, turnId } }),
  );
  const response = await fetch(`${APP_BASE}/api/sse/langy.onTurnStream?input=${input}`, {
    headers: { Cookie: cookie, Accept: "text/event-stream" },
    signal,
  });
  if (!response.ok || !response.body) return;
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const handleFrame = (frame: string): void => dispatchTurnFrame(frame, onEntry);
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let index: number;
    while ((index = buffer.indexOf("\n\n")) >= 0) {
      handleFrame(buffer.slice(0, index));
      buffer = buffer.slice(index + 2);
    }
  }
  if (buffer.trim()) handleFrame(buffer);
}

/** Watches the conversation, answers its cards (README.md "local-control-fixture.ts"). */
export function watchLangyConversation({
  adapter,
  policy = {},
  answerQuestion,
}: {
  adapter: LangyAdapter;
  policy?: PermissionPolicy;
  answerQuestion?: QuestionAnswerPicker;
}): ConversationWatcher {
  const permissions: PermissionAsk[] = [];
  const questions: QuestionAsk[] = [];
  const workspaceEvents: {
    state: string;
    name: string;
    root: string;
  }[] = [];
  const turnIds: string[] = [];
  const navigateHrefs: string[] = [];
  const toolEvents: LangyToolEvent[] = [];
  const answeredWaits = new Set<string>();
  const watchedTurns = new Set<string>();
  const controller = new AbortController();
  /** What the developer answered, waiting to be put in front of the judge. */
  let answerNotes: string[] = [];
  let stopped = false;
  /** The one card the terminal is about to answer, while it is armed. */
  let leftToTerminal: RegExp | null = null;

  const decide = (summary: string): "allow_once" | "allow_pattern" | "deny" => {
    if ((policy.deny ?? []).some((rule) => rule.test(summary))) return "deny";
    if ((policy.allowPattern ?? []).some((rule) => rule.test(summary))) {
      return "allow_pattern";
    }
    return policy.fallback ?? "allow_once";
  };

  const answerPermission = async (entry: StreamEntry, turnId: string): Promise<void> => {
    const waitId = stringField(entry.waitId);
    if (!waitId || answeredWaits.has(waitId)) return;
    if (entry.status !== "pending") return;
    answeredWaits.add(waitId);
    const summary = stringField(entry.summary);
    // The terminal takes the first matching card, on its default option, which
    // is the session grant. Nothing is sent from here for that one.
    const inTerminal = leftToTerminal?.test(summary) === true;
    if (inTerminal) leftToTerminal = null;
    const decision = inTerminal ? "allow_pattern" : decide(summary);
    const ask: PermissionAsk = {
      waitId,
      callId: stringField(entry.callId),
      summary,
      pattern: stringField(entry.pattern),
      reason: stringField(entry.reason),
      skipOffered: entry.skipOffered === true,
      decision,
      answeredIn: inTerminal ? "terminal" : "panel",
      turnId,
      askedAt: Date.now(),
    };
    permissions.push(ask);
    answerNotes.push(permissionAnswerNote(ask));
    if (inTerminal) return;
    const cookie = await getSessionCookie();
    await trpcMutate({
      cookie,
      path: "langy.answerLocalPermission",
      input: {
        projectId: CONFIG.PROJECT_ID,
        conversationId: adapter.state.conversationId,
        waitId,
        decision,
      },
    }).catch((error) => {
      // A card that settled before the answer is the product's own race, not
      // a fixture failure: record it and let the assertions speak.
      console.log(`[fixture] permission answer refused: ${String(error)}`);
    });
  };

  const answerQuestionCard = async (entry: StreamEntry, turnId: string): Promise<void> => {
    const waitId = stringField(entry.waitId);
    if (!waitId || answeredWaits.has(waitId)) return;
    if (entry.status !== "pending") return;
    answeredWaits.add(waitId);
    const asked = (
      Array.isArray(entry.questions) ? entry.questions : []
    ) as QuestionAsk["questions"];
    const answers: { question: string; selected: string[] }[] = [];
    for (const question of asked) {
      answers.push({
        question: question.question,
        selected:
          (await answerQuestion?.(question)) ??
          (question.options?.[0]?.label ? [question.options[0].label] : []),
      });
    }
    const ask: QuestionAsk = {
      waitId,
      questions: asked,
      answered: answers,
      turnId,
    };
    questions.push(ask);
    answerNotes.push(questionAnswerNote(ask));
    const cookie = await getSessionCookie();
    await trpcMutate({
      cookie,
      path: "langy.answerQuestion",
      input: {
        projectId: CONFIG.PROJECT_ID,
        conversationId: adapter.state.conversationId,
        waitId,
        answers,
      },
    }).catch((error) => {
      console.log(`[fixture] question answer refused: ${String(error)}`);
    });
  };

  const watchTurn = (turnId: string): void => {
    if (watchedTurns.has(turnId)) return;
    watchedTurns.add(turnId);
    turnIds.push(turnId);
    void (async () => {
      const cookie = await getSessionCookie();
      await readTurnEntries({
        cookie,
        conversationId: adapter.state.conversationId ?? "",
        turnId,
        signal: controller.signal,
        onEntry: (entry) => {
          if (entry.type === "local_permission") {
            void answerPermission(entry, turnId);
          } else if (entry.type === "question") {
            void answerQuestionCard(entry, turnId);
          } else if (entry.type === "navigate" && typeof entry.href === "string") {
            navigateHrefs.push(entry.href);
          } else if (entry.type === "tool") {
            const event = toolEventOf({ entry, turnId });
            if (event) toolEvents.push(event);
          } else if (entry.type === "local_workspace") {
            workspaceEvents.push({
              state: stringField(entry.state),
              name: stringField(entry.name),
              root: stringField(entry.root),
            });
          }
        },
      }).catch(() => undefined);
    })();
  };

  const readConversation = async (): Promise<{
    currentTurnId: string | null;
    /** The last turn's failure, as the record stored it, or null. */
    lastError: string | null;
    messages: {
      id: string;
      role: string;
      parts: Record<string, unknown>[];
    }[];
  } | null> => {
    const conversationId = adapter.state.conversationId;
    if (!conversationId) return null;
    const cookie = await getSessionCookie();
    return trpcQuery({
      cookie,
      path: "langy.messages",
      input: { projectId: CONFIG.PROJECT_ID, conversationId },
    });
  };

  /** Every card this conversation's record holds, answered ones included. */
  const readRecordWaits = async (): Promise<RecordWait[]> => {
    const conversationId = adapter.state.conversationId;
    if (!conversationId) return [];
    const cookie = await getSessionCookie();
    const record = await trpcQuery<{ waits?: RecordWait[] }>({
      cookie,
      path: "langy.localRecord",
      input: { projectId: CONFIG.PROJECT_ID, conversationId },
    });
    return record?.waits ?? [];
  };

  void (async () => {
    while (!stopped) {
      try {
        const snapshot = await readConversation();
        if (snapshot?.currentTurnId) watchTurn(snapshot.currentTurnId);
        if (adapter.state.currentTurnId) {
          watchTurn(adapter.state.currentTurnId);
        }
        // Cards come off the record, not off the stream. The record folds the
        // whole event log per call, so it is read while a turn is in flight and
        // not between turns, which is also the only time a card can be up.
        if (snapshot?.currentTurnId ?? adapter.state.currentTurnId) {
          const dispatches = pendingWaitDispatches({
            waits: await readRecordWaits(),
            answered: answeredWaits,
          });
          for (const dispatch of dispatches) {
            if (dispatch.kind === "question") {
              void answerQuestionCard(dispatch.entry, dispatch.turnId);
            } else {
              void answerPermission(dispatch.entry, dispatch.turnId);
            }
          }
        }
      } catch (error) {
        // The conversation may not exist yet, or the app may be busy.
        console.debug(`[fixture] conversation read retry: ${String(error)}`);
      }
      await sleep(1_000);
    }
  })();

  const messageText = (message: { role: string; parts: Record<string, unknown>[] }): string =>
    storedProse(message.parts);

  /** Reads a turn's answer, waiting for it to be stored (README.md "local-control-fixture.ts"). */
  const readTurnAnswer = async ({
    turnId,
    timeoutMs = 60_000,
  }: {
    turnId?: string;
    timeoutMs?: number;
  }): Promise<StoredMessage | null> => {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const snapshot = await readConversation().catch(() => null);
      const messages = (snapshot?.messages ?? []) as StoredMessage[];
      const answer = turnId
        ? answerOfTurn(messages, turnId)
        : (messages.filter((message) => message.role === "assistant").pop() ?? null);
      // A named turn that stored its answer is readable whatever happened
      // after it. Without a name, the last answer is only this turn's answer
      // while the conversation has not failed.
      if (answer && (turnId || !snapshot?.lastError)) return answer;
      if (snapshot?.lastError) {
        throw new Error(turnFailureMessage({ turnId, failure: snapshot.lastError }));
      }
      if (Date.now() > deadline) {
        if (!turnId) return null;
        throw new Error(
          `Turn ${turnId} stored no answer within ${Math.round(
            timeoutMs / 1000,
          )}s, and the conversation records no failure for it`,
        );
      }
      await sleep(1_000);
    }
  };

  return {
    permissions,
    questions,
    drainAnswerNotes: () => {
      const notes = answerNotes;
      answerNotes = [];
      return notes;
    },
    leaveNextPermissionToTerminal: (match) => {
      leftToTerminal = match;
    },
    workspaceEvents,
    navigateHrefs,
    toolEvents,
    turnIds,
    turnsStartedWithoutUs: (knownTurnIds) => turnIds.filter((id) => !knownTurnIds.includes(id)),
    waitForNewTurn: async ({ knownTurnIds, timeoutMs = 240_000 }) =>
      waitFor({
        what: "a turn the panel started on its own",
        timeoutMs,
        read: () => turnIds.find((id) => !knownTurnIds.includes(id)) ?? null,
      }),
    waitForIdle: async (timeoutMs = 600_000) => {
      // A turn that has not started yet also reads as idle, so the wait first
      // asks for one moment of work and only then for quiet.
      await waitFor({
        what: "the conversation to go idle",
        timeoutMs,
        intervalMs: 2_000,
        read: async () => {
          const snapshot = await readConversation();
          return snapshot !== null && snapshot.currentTurnId === null;
        },
      });
    },
    transcript: async () => {
      const snapshot = await readConversation();
      const body = (snapshot?.messages ?? [])
        .map((message) => `### ${message.role}\n\n${messageText(message)}`)
        .join("\n\n");
      // The failure is part of what happened, so it is read where the rest of
      // the conversation is read.
      return snapshot?.lastError ? `${body}\n\n### turn failed\n\n${snapshot.lastError}` : body;
    },
    lastAssistantText: async (input = {}) => {
      const answer = await readTurnAnswer(input);
      return answer ? messageText(answer) : "";
    },
    lastTurnMessages: async (input = {}) => {
      const answer = await readTurnAnswer(input);
      if (!answer) return [];
      return judgeMessages(answer);
    },
    cardAnsweredInsideTurn: async ({ turnId }) => {
      const answer = await readTurnAnswer({ turnId });
      return (answer?.parts ?? []).some(
        (part) => part.type === "tool-question" && part.state === "output-available",
      );
    },
    stop: () => {
      stopped = true;
      controller.abort();
    },
  };
}

// ---------------------------------------------------------------------------
// The conversation's own local-control state
// ---------------------------------------------------------------------------

export interface LocalWorkspaceStatus {
  connected: boolean;
  workspace: { root?: string; name?: string; hostname?: string } | null;
  skipAllowed: boolean;
  skipPermissions: boolean;
  pendingRequest: { id: string; expiresAt: string } | null;
  codeAccessPreference: "github" | null;
}

/** What the panel chip and the code access card read. */
export async function getLocalWorkspace(conversationId: string): Promise<LocalWorkspaceStatus> {
  const cookie = await getSessionCookie();
  return trpcQuery<LocalWorkspaceStatus>({
    cookie,
    path: "langy.getLocalWorkspace",
    input: { projectId: CONFIG.PROJECT_ID, conversationId },
  });
}

/** Remember, or forget, how Langy reaches this person's code. */
export async function setCodeAccessPreference(preference: "github" | null): Promise<void> {
  const cookie = await getSessionCookie();
  await trpcMutate({
    cookie,
    path: "langy.setCodeAccessPreference",
    input: { projectId: CONFIG.PROJECT_ID, preference },
  });
}

/** Close the shared folder the way the panel header chip closes it. */
export async function disconnectLocalWorkspace(conversationId: string): Promise<void> {
  const cookie = await getSessionCookie();
  await trpcMutate({
    cookie,
    path: "langy.disconnectLocalWorkspace",
    input: { projectId: CONFIG.PROJECT_ID, conversationId },
  });
}

/** Wait until the conversation records the control request the card renders. */
export async function waitForPendingRequest({
  conversationId,
  timeoutMs = 300_000,
}: {
  conversationId: string;
  timeoutMs?: number;
}): Promise<{ id: string; expiresAt: string }> {
  return waitFor({
    what: "the code access card's control request",
    timeoutMs,
    read: async () => (await getLocalWorkspace(conversationId)).pendingRequest,
  });
}

/** Wait until the folder is connected to the conversation. */
export async function waitForConnectedWorkspace({
  conversationId,
  timeoutMs = 300_000,
}: {
  conversationId: string;
  timeoutMs?: number;
}): Promise<LocalWorkspaceStatus> {
  return waitFor({
    what: "the folder to connect to the conversation",
    timeoutMs,
    read: async () => {
      const status = await getLocalWorkspace(conversationId);
      return status.connected ? status : null;
    },
  });
}

// ---------------------------------------------------------------------------
// The demo application, running
// ---------------------------------------------------------------------------

/** A free TCP port, so two runs never fight over one. */
export async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

/**
 * Keeps one entry out of the repository through git's own exclude file, so
 * the demo's `.gitignore` stays exactly as it ships and Langy never commits
 * the credentials the fixture wrote.
 */
async function excludeFromGit({ root, entry }: { root: string; entry: string }): Promise<void> {
  const excludeFile = path.join(root, ".git", "info", "exclude");
  await fs.mkdir(path.dirname(excludeFile), { recursive: true });
  const current = existsSync(excludeFile) ? await fs.readFile(excludeFile, "utf8") : "";
  const existingLines = current.split("\n").map((line) => line.trim());
  if (existingLines.includes(entry)) return;
  const separator = current === "" || current.endsWith("\n") ? "" : "\n";
  await fs.appendFile(excludeFile, `${separator}${entry}\n`, "utf8");
}

/** How the repository itself starts the demo application, on one port. */
function demoStartCommand({ repo, port }: { repo: DemoRepo; port: number }): {
  command: string;
  args: string[];
} {
  return DEMO[repo.language].runtime === "uv"
    ? {
        command: "uv",
        args: ["run", "uvicorn", "app.main:app", "--port", String(port)],
      }
    : { command: "npm", args: ["run", "start"] };
}

/** The demo application, running from the shared folder. */
export interface DemoApp {
  port: number;
  sessionName: string;
  logPath: string;
  capture: () => string;
  stop: () => void;
}

/** Starts the demo app from the shared folder, connected (README.md "local-control-fixture.ts"). */
export async function startDemoApp({
  repo,
  label,
  port,
}: {
  repo: DemoRepo;
  label: string;
  port?: number;
}): Promise<DemoApp> {
  const apiKey = await getCliApiKey();
  const chosenPort = port ?? (await freePort());
  await fs.writeFile(
    path.join(repo.root, ".env"),
    [
      `LANGWATCH_ENDPOINT=${APP_BASE}`,
      `LANGWATCH_API_KEY=${apiKey}`,
      "LANGWATCH_AGENT_CONNECT=1",
      ...demoProviderEnvLines(),
      "",
    ].join("\n"),
    "utf8",
  );
  await excludeFromGit({ root: repo.root, entry: ".env" });
  const sessionName = `acme-${label}-${Date.now().toString(36)}`;
  const logPath = path.join(repo.root, "..", `${sessionName}.log`);
  const start = demoStartCommand({ repo, port: chosenPort });
  const command = [start.command, ...start.args].join(" ");
  const script = path.join(repo.root, "..", `${sessionName}.sh`);
  await fs.writeFile(
    script,
    [
      "#!/bin/bash",
      `cd ${JSON.stringify(repo.root)}`,
      `export LANGWATCH_ENDPOINT=${JSON.stringify(APP_BASE)}`,
      `export LANGWATCH_API_KEY=${JSON.stringify(apiKey)}`,
      "export LANGWATCH_AGENT_CONNECT=1",
      `export PORT=${chosenPort}`,
      "unset TRACEPARENT",
      `exec ${command} 2>&1 | tee ${JSON.stringify(logPath)}`,
      "",
    ].join("\n"),
    { encoding: "utf8", mode: 0o755 },
  );
  sh("tmux", ["new-session", "-d", "-s", sessionName, "-x", "200", "-y", "60", "bash", script]);
  const capture = (): string =>
    spawnSync("tmux", ["capture-pane", "-p", "-t", sessionName, "-S", "-3000"], {
      encoding: "utf8",
      maxBuffer: 8 * 1024 * 1024,
    }).stdout ?? "";
  return {
    port: chosenPort,
    sessionName,
    logPath,
    capture,
    stop: () => {
      spawnSync("tmux", ["kill-session", "-t", sessionName]);
    },
  };
}

/** What the demo's own HTTP route answered, on the branch Langy left behind. */
export interface DemoRouteAnswer {
  status: number;
  /** The `output` field of the reply, empty when there was none. */
  output: string;
  /** Empty when the route answered, otherwise why it could not be reached. */
  unreachable: string;
  /** The last lines the application printed, which name the exception. */
  lines: string;
}

/** Asks the demo app's own endpoint for one turn (README.md "local-control-fixture.ts"). */
/** Waits for `/health`, or the failure that says why not (README.md "local-control-fixture.ts"). */
async function waitForDemoAppHealthy({
  base,
  startTimeoutMs,
  child,
  getSpawnFailure,
  tail,
}: {
  base: string;
  startTimeoutMs: number;
  child: ReturnType<typeof spawn>;
  getSpawnFailure: () => string;
  tail: () => string;
}): Promise<DemoRouteAnswer | null> {
  const deadline = Date.now() + startTimeoutMs;
  let healthy = false;
  while (!healthy && Date.now() < deadline) {
    const spawnFailure = getSpawnFailure();
    if (spawnFailure !== "") {
      return {
        status: 0,
        output: "",
        unreachable: `it could not be started: ${spawnFailure}`,
        lines: tail(),
      };
    }
    if (child.exitCode !== null) {
      return {
        status: 0,
        output: "",
        unreachable: `it exited with code ${child.exitCode} before it listened`,
        lines: tail(),
      };
    }
    try {
      healthy = (await fetch(`${base}/health`)).ok;
    } catch (error) {
      console.debug(`[fixture] health check not ready: ${String(error)}`);
    }
    if (!healthy) await sleep(2_000);
  }
  if (healthy) return null;
  return {
    status: 0,
    output: "",
    unreachable: `it never answered on ${base}/health within ${Math.round(startTimeoutMs / 1000)}s`,
    lines: tail(),
  };
}

export async function callDemoChatRoute({
  repo,
  message = "where is my order 10042?",
  startTimeoutMs = 240_000,
  replyTimeoutMs = 180_000,
}: {
  repo: DemoRepo;
  message?: string;
  startTimeoutMs?: number;
  replyTimeoutMs?: number;
}): Promise<DemoRouteAnswer> {
  const port = await freePort();
  const logPath = path.join(repo.root, "..", `chat-route-${Date.now().toString(36)}.log`);
  const log = openSync(logPath, "w");
  const start = demoStartCommand({ repo, port });
  const child = spawn(start.command, start.args, {
    cwd: repo.root,
    detached: true,
    stdio: ["ignore", log, log],
    env: { ...process.env, PORT: String(port) },
  });
  let spawnFailure = "";
  child.on("error", (error) => {
    spawnFailure = String(error);
  });
  const base = `http://127.0.0.1:${port}`;
  const tail = (): string => {
    const text = existsSync(logPath) ? readFileSync(logPath, "utf8") : "";
    return text.split("\n").slice(-12).join("\n").trim();
  };
  const stop = (): void => {
    try {
      if (child.pid) process.kill(-child.pid, "SIGTERM");
    } catch (error) {
      // The process group is already gone, which is the state this wants.
      console.debug(`[fixture] process group already gone: ${String(error)}`);
    }
  };

  try {
    const notHealthy = await waitForDemoAppHealthy({
      base,
      startTimeoutMs,
      child,
      getSpawnFailure: () => spawnFailure,
      tail,
    });
    if (notHealthy) return notHealthy;
    let reply: Response;
    try {
      reply = await fetch(`${base}/chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          messages: [{ role: "user", content: message }],
        }),
        signal: AbortSignal.timeout(replyTimeoutMs),
      });
    } catch (error) {
      return {
        status: 0,
        output: "",
        unreachable: `it did not answer the request within ${Math.round(replyTimeoutMs / 1000)}s: ${String(error)}`,
        lines: tail(),
      };
    }
    const text = await reply.text();
    let output = "";
    try {
      output = stringField((JSON.parse(text) as { output?: unknown }).output);
    } catch (error) {
      // The server's own text carries the failure; log it and let the caller
      // read the empty output from the log instead.
      console.debug(`[fixture] response body was not the expected JSON: ${String(error)}`);
    }
    return {
      status: reply.status,
      output,
      unreachable: "",
      lines: tail(),
    };
  } finally {
    stop();
    closeSync(log);
  }
}

/** The agents this project has registered, read back over the public API. */
export async function readAgent(name: string): Promise<{
  id: string;
  name: string;
  parameters?: unknown;
} | null> {
  // The demo registers with the key this fixture minted, and that key owns
  // the agent it creates: a connection made with a project key is a different
  // identity and a different row. Reading with the project key from the
  // environment would find that other row, which no run of this suite ever
  // touches, and report the parameters it had months ago.
  const apiKey = await getCliApiKey();
  const response = await fetch(`${APP_BASE}/api/v1/agents`, {
    headers: { "X-Auth-Token": apiKey, "X-Project-Id": CONFIG.PROJECT_ID },
  });
  if (!response.ok) return null;
  const body = (await response.json()) as unknown;
  const rows = Array.isArray(body)
    ? body
    : ((body as { agents?: unknown[]; data?: unknown[] }).agents ??
      (body as { data?: unknown[] }).data ??
      []);
  const named = (
    rows as {
      id: string;
      name: string;
      parameters?: unknown;
      lastSeenAt?: string;
    }[]
  ).filter((agent) => agent.name === name);
  // A folder shared from another machine leaves its own row behind, so the
  // newest connection is the one this run is asserting about.
  return (
    named.toSorted(
      (left, right) => Date.parse(right.lastSeenAt ?? "") - Date.parse(left.lastSeenAt ?? ""),
    )[0] ?? null
  );
}

/** Process ids listening on one port (README.md "local-control-fixture.ts"). */
export function listeningPids(lsofOutput: string): number[] {
  const pids = new Set<number>();
  for (const line of lsofOutput.split("\n").slice(1)) {
    const pid = Number.parseInt(line.trim().split(/\s+/)[1] ?? "", 10);
    if (Number.isInteger(pid)) pids.add(pid);
  }
  return [...pids];
}

/** Process ids whose cwd is inside one folder (README.md "local-control-fixture.ts"). */
export function pidsRunningIn({
  lsofOutput,
  root,
}: {
  lsofOutput: string;
  root: string;
}): number[] {
  const pids = new Set<number>();
  let current: number | null = null;
  for (const line of lsofOutput.split("\n")) {
    if (line.startsWith("p")) {
      const pid = Number.parseInt(line.slice(1), 10);
      current = Number.isInteger(pid) ? pid : null;
      continue;
    }
    if (!line.startsWith("n") || current === null) continue;
    const cwd = line.slice(1);
    if (cwd === root || cwd.startsWith(`${root}/`)) pids.add(current);
  }
  return [...pids];
}

/** Read one lsof invocation, or nothing when lsof is absent or finds nobody. */
function lsof(args: string[]): string {
  return spawnSync("lsof", args, { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 }).stdout ?? "";
}

/** End one process, its group first, so a shell takes its children with it. */
function endProcess(pid: number): void {
  if (pid <= 1 || pid === process.pid || pid === process.ppid) return;
  for (const signal of ["SIGTERM", "SIGKILL"] as const) {
    try {
      process.kill(-pid, signal);
    } catch {
      try {
        process.kill(pid, signal);
      } catch {
        return;
      }
    }
  }
}

/** Everything this run started on the machine, ended (README.md "local-control-fixture.ts"). */
export function killScenarioProcesses({ port, root }: { port?: number; root?: string }): void {
  const pids = new Set<number>();
  if (port) {
    for (const pid of listeningPids(lsof(["-nP", `-iTCP:${port}`, "-sTCP:LISTEN"]))) {
      pids.add(pid);
    }
  }
  if (root) {
    for (const pid of pidsRunningIn({
      lsofOutput: lsof(["-d", "cwd", "-Fpn"]),
      root,
    })) {
      pids.add(pid);
    }
  }
  for (const pid of pids) endProcess(pid);
}

/** Everything a scenario opened, closed in the order that leaves nothing behind. */
export async function teardown({
  terminal,
  watcher,
  app,
  repo,
}: {
  terminal?: CliTerminal;
  watcher?: ConversationWatcher;
  app?: DemoApp;
  repo?: Pick<DemoRepo, "root">;
}): Promise<void> {
  app?.stop();
  watcher?.stop();
  if (terminal) {
    await terminal.disconnect().catch(() => undefined);
    terminal.stop();
  }
  killScenarioProcesses({
    ...(app ? { port: app.port } : {}),
    ...(repo ? { root: repo.root } : {}),
  });
}

/** The terminal capture, for the scenario transcript. */
export function terminalSection(terminal: CliTerminal): string {
  return ["## Terminal", "", "```", terminal.capture().trim(), "```"].join("\n");
}

/** Best-effort note in the log when the machine has no `uv` or no `tmux`. */
export function assertToolsPresent(): void {
  for (const tool of ["tmux", "git", "node"]) {
    if (spawnSync("which", [tool]).status !== 0) {
      throw new Error(
        `${tool} is not on PATH; the local control scenarios drive the real command line and need it`,
      );
    }
  }
}
