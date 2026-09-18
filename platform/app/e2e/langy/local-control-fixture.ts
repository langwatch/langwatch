/**
 * The harness for the local control scenarios (ADR-129).
 *
 * It builds the world the feature needs and nothing more:
 *
 *  1. a demo application copied into a temporary git repository, with the
 *     LangWatch SDK dependency pointed at this checkout so the copy resolves
 *     outside the monorepo,
 *  2. the REAL command line, `langwatch langy --share-control`, in a tmux
 *     session, driven with `send-keys` the way a developer drives it,
 *  3. a watcher on the conversation that answers the permission cards and the
 *     question cards through tRPC, as the user, on a policy the test sets.
 *
 * Nothing here mocks the product. The scenario asks Langy in the panel's own
 * tRPC surface, Langy's tools reach the machine over the control socket, and
 * the facts the tests assert come from the repository, the terminal and the
 * conversation record.
 *
 * @see specs/langy/langy-dogfood-scenarios.feature
 * @see dev/docs/adr/129-langy-local-control.md
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
import { APP_BASE, PROJECT_ID } from "./config";
import {
  type LangyAdapter,
  type LangyToolEvent,
  toolEventOf,
} from "./langy-agent";
import { getSessionCookie, trpcMutate, trpcQuery } from "./trpc";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** The repository root of this checkout, from `platform/app/e2e/langy`. */
export const REPO_ROOT = path.resolve(__dirname, "../../../..");

/**
 * Where a run puts the temporary folders it shares with Langy.
 *
 * Outside every checkout, and that is the whole point. git finds a repository
 * by walking up, so a folder with no repository of its own that sits inside a
 * checkout is inside that checkout's repository: the scenario whose premise is
 * a folder with no repository had Langy run `git checkout -b` there, and the
 * branch landed on the lane's own checkout while the run was going, moving its
 * HEAD and firing its hooks. A folder outside every checkout cannot be walked
 * into one.
 *
 * The share-control profile also exports `GIT_CEILING_DIRECTORIES`, which stops
 * the walk when a command can read it. That is a second belt and not the fix:
 * the CLI hands each command an allowlisted environment, on purpose, and the
 * ceiling is not on the list, so it never reaches the command that needs it.
 */
export const SCENARIO_REPO_DIR =
  process.env.LANGY_SCENARIO_REPO_DIR ??
  path.join(os.homedir(), ".langwatch-scenario-repos");

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

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * The model key the demo applications need, from the environment or from the
 * app's own `.env`, which is where this checkout keeps it.
 */
export function openaiKey(): string {
  const fromEnvironment = process.env.OPENAI_API_KEY;
  if (fromEnvironment) return fromEnvironment;
  try {
    const dotenv = readFileSync(
      path.join(REPO_ROOT, "platform", "app", ".env"),
      "utf8",
    );
    return /^OPENAI_API_KEY=(.*)$/m.exec(dotenv)?.[1]?.trim() ?? "";
  } catch {
    return "";
  }
}

/**
 * The provider values the demo application reads from its own `.env`.
 * `app/graph.py` builds an Azure model when the three Azure values are set and
 * an OpenAI one otherwise, so a run moves the demo with LANGY_GUIDED_PROVIDER
 * the same way it moves Langy and the judge.
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
 * Polls until `read` answers something truthy, then returns it.
 *
 * Every wait in this file goes through here so a timeout says what it was
 * waiting for rather than dying on an assertion three steps later.
 */
async function waitFor<T>({
  what,
  read,
  timeoutMs,
  intervalMs = 1_000,
}: {
  what: string;
  read: () =>
    | Promise<T | null | undefined | false>
    | T
    | null
    | undefined
    | false;
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
          lastError ? ` (last error: ${String(lastError)})` : ""
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
    Array<{
      id: string;
      teams?: Array<{ projects?: Array<{ id: string }> }>;
    }>
  >({ cookie, path: "organization.getAll", input: {} });
  const organizationId =
    organizations.find((organization) =>
      (organization.teams ?? []).some((team) =>
        (team.projects ?? []).some((project) => project.id === PROJECT_ID),
      ),
    )?.id ?? organizations[0]?.id;
  if (!organizationId) {
    throw new Error(
      `no organization holds project ${PROJECT_ID}; check LANGY_PROJECT_ID`,
    );
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
 * Sign the command line in the way `langwatch login --device` does, as the
 * test's own user, and write the config file that login writes.
 *
 * The three steps are the product's own device flow: the command line's
 * `device-code` request, the browser's `approve` (sent here with the user's
 * session cookie, with no key selection, so the server stamps the default the
 * authorize screen offers), and the command line's `exchange`. The file
 * carries what `persistDeviceSession` keeps of the exchange, so
 * `resolveCredentials` walks the same path a developer's login walks: the
 * session, the personal project and the login key. No project key reaches the
 * terminal's environment; a control request belongs to a person, and the
 * person is who the login names.
 */
export async function writeCliLoginConfig({
  configPath,
}: {
  configPath: string;
}): Promise<void> {
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
    ...(result.default_personal_vk
      ? { default_personal_vk: result.default_personal_vk }
      : {}),
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
 * A user-scoped API key for the test's own user, bound to the test project.
 *
 * The scenario library reports its runs to the platform and the demo
 * application it shares needs a key of its own, and the platform reads the
 * test makes (open requests, conversations) authenticate the same way. The
 * fixture mints the same class of credential the login mints, through the
 * product's own `apiKey.create` mutation, as the signed-in user. The
 * share-control terminal never sees it: that one signs in through
 * `writeCliLoginConfig`.
 *
 * The key carries one PROJECT-scoped binding, so the platform resolves the
 * project from the key alone.
 *
 * The mint is read back before it is used. A `apiKey.create` that answers 200
 * has been seen to leave the binding unwritten under load, and the key that
 * comes back then reaches every route with "does not grant langy:view". That
 * failure surfaces two minutes later as a command line that never printed its
 * prompt, which says nothing about the cause, so it is caught here instead.
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
            bindings: [
              { role: "ADMIN", scopeType: "PROJECT", scopeId: PROJECT_ID },
            ],
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
      throw new Error(
        `every minted key was refused by the control route: ${refusal}`,
      );
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
      headers: { "X-Auth-Token": token, "X-Project-Id": PROJECT_ID },
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
 * Point the demo's LangWatch SDK dependency at this checkout by absolute path.
 *
 * The support applications depend on the SDK through a relative path that only
 * resolves inside the monorepo (`../../../../sdks/python`,
 * `file:../../../../sdks/typescript`). A copy outside it must name the same
 * SDK by its absolute path, or the install fails and the scenario measures the
 * fixture rather than the product.
 *
 * The checkout application has no SDK dependency, Langy adds it, so the
 * rewrite finds nothing there and its manifest stays byte for byte as shipped.
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
    manifest.dependencies.langwatch = `file:${path.join(
      REPO_ROOT,
      "sdks",
      "typescript",
    )}`;
  }
  await fs.writeFile(file, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}

/**
 * A demo application as its own git repository, on `main`, with one commit.
 *
 * The install is what makes the folder real: Langy runs the project's own
 * checks on it, and a folder with no dependencies would push it into
 * installing them itself and grade the wrong thing.
 */
/** How many finished runs keep their folder on disk. */
const DEMO_REPOS_KEPT = 4;

/**
 * The folders to delete, newest kept.
 *
 * An installed demo repository is about 400 MB, and one is made per scenario
 * run: a morning of runs filled the disk. The most recent few stay so a failed
 * run can still be read on disk.
 */
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
      const stamp = Number.parseInt(
        folder.slice(folder.lastIndexOf("-") + 1),
        36,
      );
      return { folder, stamp: Number.isNaN(stamp) ? 0 : stamp };
    })
    .sort((a, b) => b.stamp - a.stamp);
  return stamped.slice(Math.max(0, keep)).map((entry) => entry.folder);
}

/** Delete every demo repository but the most recent few, remotes included. */
async function pruneDemoRepos(): Promise<void> {
  const entries = await fs
    .readdir(SCENARIO_REPO_DIR, { withFileTypes: true })
    .catch(() => []);
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
  const root = path.join(
    SCENARIO_REPO_DIR,
    `${name}-${Date.now().toString(36)}`,
  );
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

/**
 * The folders a scenario can share that are NOT one of the demo applications.
 *
 * A demo repository is a working project: installed, committed, with a remote.
 * These are the opposite, and each one exists for a scenario about the folder
 * rather than about the code. `acme-notes` is a pip project: its manifest is
 * `requirements.txt`, there is no lock file and no virtual environment, and
 * nothing is installed until Langy installs it.
 */
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
 * Copy a fixture folder somewhere temporary and hand it to a scenario.
 *
 * Nothing is installed: a scenario that shares one of these is about what
 * Langy does with a project as it finds it, and an install by the fixture
 * would answer the question the scenario is asking. `git: false` leaves the
 * copy with no repository at all, which is its own scenario.
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
  const root = path.join(
    SCENARIO_REPO_DIR,
    `${name}-${Date.now().toString(36)}`,
  );
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

/**
 * The newest interpreter on this machine that the published SDK supports.
 *
 * Every `langwatch` release from 0.2.11 to 1.4.0 declares
 * `requires-python >=3.10,<3.14`. On a machine whose `python3` is 3.14, pip
 * resolves `pip install langwatch` past all of them and down to 0.1.32, a
 * release from before `setup()` and `connect_agent()` existed: the install
 * reports success, and the tracing code the project just gained cannot
 * import. A scenario about a missing package manager spelling would then be
 * failing on the interpreter instead, so the venv is built from a version the
 * SDK actually ships for.
 */
function supportedPython(): string {
  for (const name of ["python3.13", "python3.12", "python3"]) {
    const found = spawnSync("which", [name], { encoding: "utf8" });
    if (found.status === 0 && found.stdout.trim()) {
      return realPython(found.stdout.trim());
    }
  }
  return "python3";
}

/**
 * The interpreter behind whatever `which` answered.
 *
 * A uv-installed Python is reached through a symlink in `~/.local/bin`, and
 * `venv` writes the directory of the interpreter it was invoked as into
 * `pyvenv.cfg` as `home`. Invoked through the symlink that is `~/.local/bin`,
 * which holds no `lib/pythonX.Y`, so the environment it builds starts with
 * `Fatal Python error: Failed to import encodings module` and every scenario
 * that needs one fails in setup on a machine where the interpreter itself is
 * fine. Resolving the link first puts the real install's `bin` in `home`.
 */
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
 * Build a Python interpreter beside the shared folder, for the terminal to use.
 *
 * A packaged interpreter refuses to install into itself (Homebrew and the
 * system Python both ship `EXTERNALLY-MANAGED`), so on such a machine every
 * rung of the install ladder fails for a reason that has nothing to do with
 * what a scenario is asking. A virtual environment of the scenario's own is
 * the ordinary machine that scenario assumes: `pip3` installs, `python3`
 * imports, and the developer's own Python is left alone.
 *
 * It sits BESIDE the shared folder, never in it: a `.venv` inside the folder
 * is a fact about the project that the install ladder reads, and these
 * scenarios are about a project that has none.
 *
 * Pass `forFolder` and the project's own `requirements.txt` is installed into
 * it, so the only thing the terminal is short of is what the scenario took
 * away. Without it the first command that imports a declared dependency fails
 * for a reason the scenario never set up.
 */
export async function createPythonEnv({
  at,
  forFolder,
  interpreter = "supported",
}: {
  at: string;
  forFolder?: string;
  /**
   * Which interpreter the environment is built from. `supported` is the
   * newest version the published SDK ships for, which is what a scenario
   * about anything else wants. `machine-default` is whatever `python3` is on
   * this machine, for the one scenario whose subject IS the interpreter.
   */
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
    version: sh(
      python,
      ["-c", "import sys; print('%d.%d' % sys.version_info[:2])"],
      {
        timeoutMs: 120_000,
      },
    ).trim(),
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
const CLI_ENTRY = path.join(
  REPO_ROOT,
  "sdks",
  "typescript",
  "dist",
  "cli",
  "index.js",
);

let cliBuildPromise: Promise<void> | null = null;

/**
 * Build the command line once per test process.
 *
 * `tsup` is called rather than the package's `build` script because that
 * script runs a whole-tree `tsc --noEmit` first, which is the repository's
 * typecheck job and not this suite's. `LANGY_SKIP_CLI_BUILD=1` reuses whatever
 * is in `dist` already, for a quick re-run of a scenario.
 */
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
 * A folder holding one `langwatch` that runs the build this test made.
 *
 * The terminal starts the command line by its built entry point, but every
 * `langwatch` the agent types into the shared folder is resolved on PATH, and
 * that finds whatever copy is installed on the machine. A scenario asserting on
 * a flag the branch just added would read the installed copy's "unknown option"
 * instead.
 */
/**
 * A directory of stand-in commands, for the terminal's PATH.
 *
 * Each body is run by `/bin/sh` with the call's own arguments, so a stand-in
 * can refuse (`exit 127`), answer something fixed, or hand the call on.
 */
async function shimBinDir(
  at: string,
  shims: Record<string, string>,
): Promise<string> {
  await fs.mkdir(at, { recursive: true });
  for (const [name, body] of Object.entries(shims)) {
    await fs.writeFile(path.join(at, name), `#!/bin/sh\n${body}\n`, {
      encoding: "utf8",
      mode: 0o755,
    });
  }
  return at;
}

async function cliBinDir(at: string): Promise<string> {
  await fs.mkdir(at, { recursive: true });
  const shim = path.join(at, "langwatch");
  await fs.writeFile(
    shim,
    `#!/bin/sh\nexec node ${JSON.stringify(CLI_ENTRY)} "$@"\n`,
    { encoding: "utf8", mode: 0o755 },
  );
  return at;
}

/** The terminal the command line runs in, and the ways a test drives it. */
export interface CliTerminal {
  sessionName: string;
  /** Everything the terminal has shown so far. */
  capture: () => string;
  /** Wait until the terminal shows this text, then answer with the capture. */
  waitForText: (
    pattern: string | RegExp,
    timeoutMs?: number,
  ) => Promise<string>;
  sendKeys: (...keys: string[]) => void;
  /** Wait for the approve question and answer it with Approve. */
  approve: (timeoutMs?: number) => Promise<void>;
  /**
   * Answer the next permission ask in the terminal, on the default option.
   *
   * Arm it BEFORE the message that raises the ask, and await it after: the
   * selector opens while the turn is in flight, and Enter takes the first
   * option, which is the session grant. Resolves with the terminal's own text
   * once the settled line replaced the selector.
   */
  answerNextPermission: (
    timeoutMs?: number,
    /**
     * Wait for the box that asks about THIS command rather than for any box.
     * Several asks can be open in one run, and the panel answers the ones the
     * terminal is not meant to take.
     */
    command?: RegExp,
  ) => Promise<string>;
  /** Ctrl-C twice, which is how a developer stops sharing. */
  disconnect: () => Promise<void>;
  isRunning: () => boolean;
  /** Kill the terminal whatever state it is in. */
  stop: () => void;
}

/**
 * Cancels every control request still open for this project.
 *
 * A request a run never answered stays open for its whole window, and the next
 * `langwatch langy --share-control` then opens the picker instead of waiting.
 * Every scenario shares one project, so one run's leftovers change what the
 * next run's command line does. Clearing them first is what a developer with
 * one live conversation sees.
 */
export async function cancelOpenControlRequests(): Promise<void> {
  const apiKey = await getCliApiKey();
  const headers = {
    "X-Auth-Token": apiKey,
    "X-Project-Id": PROJECT_ID,
    "Content-Type": "application/json",
  };
  const listed = await fetch(`${APP_BASE}/api/v1/langy/control/requests`, {
    headers,
    signal: AbortSignal.timeout(30_000),
  });
  if (!listed.ok) return;
  const body = (await listed.json()) as { requests?: Array<{ id: string }> };
  for (const request of body.requests ?? []) {
    await fetch(
      `${APP_BASE}/api/v1/langy/control/requests/${encodeURIComponent(request.id)}/cancel`,
      { method: "POST", headers, signal: AbortSignal.timeout(30_000) },
    ).catch(() => undefined);
  }
}

/**
 * Start `langwatch langy --share-control` in the folder, in its own terminal.
 *
 * The command line waits when no request is open, so a scenario can start it
 * before the ask or after it and the order does not matter.
 */
export async function startShareControl({
  repo,
  label,
  clearOpenRequests = true,
  shims = {},
  pathDirs = [],
}: {
  repo: Pick<DemoRepo, "root">;
  label: string;
  /**
   * Whether to cancel the requests already open on the project first. The
   * default suits scenarios that share one project, where a leftover from
   * an earlier run would turn the command line into a picker. A scenario
   * whose own conversation asked for the folder BEFORE the command line
   * starts, on a project of its own, keeps that ask: it is the one the
   * terminal is about to answer.
   */
  clearOpenRequests?: boolean;
  /**
   * Commands to put FIRST on the terminal's PATH, as a name to the shell body
   * that stands in for it. A scenario about what Langy does when a tool is
   * missing or broken writes that here, so the absence lives in the terminal
   * the scenario owns rather than in the machine running it.
   */
  shims?: Record<string, string>;
  /**
   * Directories to put on the terminal's PATH after the shims, before the
   * machine's own. A scenario that needs a working interpreter, or any other
   * tool it built for itself, names its bin directory here.
   */
  pathDirs?: string[];
}): Promise<CliTerminal> {
  await buildCli();
  if (clearOpenRequests) await cancelOpenControlRequests();
  const sessionName = `langy-${label}-${Date.now().toString(36)}`;
  const configPath = path.join(repo.root, "..", `${sessionName}-config.json`);
  await writeCliLoginConfig({ configPath });
  const binDir = await cliBinDir(
    path.join(repo.root, "..", `${sessionName}-bin`),
  );
  const shimDir = await shimBinDir(
    path.join(repo.root, "..", `${sessionName}-shims`),
    shims,
  );
  const script = path.join(repo.root, "..", `${sessionName}.sh`);
  // The terminal signs in through the login config alone: a project key in
  // its environment would make the command line act as the project, and a
  // control request is addressed to the person.
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

  sh("tmux", [
    "new-session",
    "-d",
    "-s",
    sessionName,
    "-x",
    "200",
    "-y",
    "60",
    "bash",
    script,
  ]);

  // Everything the terminal prints, kept on disk. tmux ends the session with
  // the process and takes the last screen with it, so the goodbye line a test
  // asserts on would otherwise be gone before it could be read.
  const paneLog = path.join(repo.root, "..", `${sessionName}.log`);
  sh("tmux", [
    "pipe-pane",
    "-o",
    "-t",
    sessionName,
    `cat >> ${JSON.stringify(paneLog)}`,
  ]);

  // tmux ends the session with the process, and capture-pane on a session that
  // is gone answers nothing. The last text the terminal showed is what a test
  // asserts on after the command line exits, so every successful capture is
  // remembered and served once the session is gone.
  const readPaneLog = (): string => {
    try {
      return readFileSync(paneLog, "utf8");
    } catch {
      return "";
    }
  };
  const capture = (): string => {
    const result = spawnSync(
      "tmux",
      ["capture-pane", "-p", "-t", sessionName, "-S", "-3000"],
      { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 },
    );
    const pane = result.stdout ?? "";
    const logged = readPaneLog();
    // The live pane reads best while the session is there; once it is gone the
    // log is the only copy, and it is also the only place the last lines
    // before the exit survive.
    if (pane.trim() === "") return logged;
    return logged.includes("Leaving") ? `${pane}\n${logged}` : pane;
  };
  const isRunning = (): boolean =>
    spawnSync("tmux", ["has-session", "-t", sessionName]).status === 0;
  const sendKeys = (...keys: string[]): void => {
    spawnSync("tmux", ["send-keys", "-t", sessionName, ...keys]);
  };
  const waitForText = async (
    pattern: string | RegExp,
    timeoutMs = 120_000,
  ): Promise<string> =>
    waitFor({
      what: `the terminal to show ${String(pattern)}`,
      timeoutMs,
      intervalMs: 750,
      read: () => {
        const text = capture();
        const seen =
          typeof pattern === "string"
            ? text.includes(pattern)
            : pattern.test(text);
        return seen ? text : null;
      },
    });

  const terminal: CliTerminal = {
    sessionName,
    capture,
    waitForText,
    sendKeys,
    approve: async (timeoutMs = 240_000) => {
      // The question itself, whichever shape the terminal draws it in: the
      // plain prompt asked "Share this folder?" and the boxed selector asks
      // "Do you want to share this folder?".
      await waitForText(/share this folder\?/i, timeoutMs);
      // The picker opens on Approve, so Enter is the whole answer. A short
      // pause first: the prompt paints before it listens.
      await sleep(500);
      sendKeys("Enter");
      await waitForText("Connected", 60_000);
    },
    answerNextPermission: async (timeoutMs = 300_000, command?: RegExp) => {
      // The box sits at the bottom of the screen, so the last lines are where
      // it is read: the command it asks about appears in the transcript above
      // as well, and a match up there would answer the wrong box.
      await waitFor({
        what: command
          ? `the terminal to ask about ${String(command)}`
          : "the terminal to ask for permission",
        timeoutMs,
        intervalMs: 500,
        read: () => {
          const box = capture().split("\n").slice(-30).join("\n");
          if (!box.includes("Do you want to allow this?")) return null;
          if (command && !command.test(box)) return null;
          return box;
        },
      });
      // The selector paints before it listens, the way the approve prompt does.
      await sleep(500);
      sendKeys("Enter");
      return await waitForText(/Allowed |Denied/, 60_000);
    },
    disconnect: async () => {
      if (!isRunning()) return;
      sendKeys("C-c");
      await sleep(1_500);
      if (isRunning()) sendKeys("C-c");
      await waitFor({
        what: "the command line to exit",
        timeoutMs: 30_000,
        intervalMs: 500,
        read: () => !isRunning(),
      }).catch(() => undefined);
    },
    isRunning,
    stop: () => {
      spawnSync("tmux", ["kill-session", "-t", sessionName]);
    },
  };
  await terminal.waitForText(
    /Waiting for a Langy conversation|share this folder\?/i,
    120_000,
  );
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
  questions: Array<{
    question: string;
    options?: Array<{ label: string; quiet?: boolean }>;
  }>;
  answered: Array<{ question: string; selected: string[] }>;
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

/**
 * Picks the answer to one question card. Default: the first option.
 *
 * It may read the world before it answers: the guided onboarding suite
 * checks that nothing was created yet while Langy's proposal is still open.
 */
export type QuestionAnswerPicker = (question: {
  question: string;
  options?: Array<{ label: string; quiet?: boolean }>;
}) => string[] | Promise<string[]>;

/** One message in the shape the scenario judge reads. */
export type JudgeMessage =
  | { role: "assistant"; content: string }
  | {
      role: "assistant";
      content: Array<
        | { type: "text"; text: string }
        | {
            type: "tool-call";
            toolCallId: string;
            toolName: string;
            input: unknown;
          }
      >;
    }
  | {
      role: "tool";
      content: Array<{
        type: "tool-result";
        toolCallId: string;
        toolName: string;
        output: { type: "text" | "error-text"; value: string };
      }>;
    };

/** What the watcher saw on the conversation, and what it answered. */
export interface ConversationWatcher {
  permissions: PermissionAsk[];
  questions: QuestionAsk[];
  /**
   * The answers the developer has given on cards since the last drain, one
   * line each, and empties the list.
   *
   * The fixture answers a card through the panel's own mutation, which is
   * exactly what the developer does and exactly why the judge cannot see it:
   * the conversation it grades holds Langy's messages and tool results, and
   * the answer never appears in either. A criterion about what Langy did AFTER
   * a grant or a denial then has nothing to read. Feed these lines into the
   * scenario after each turn to put the developer's side of the card in the
   * record.
   */
  drainAnswerNotes: () => string[];
  /**
   * Leave the next card whose command matches to the terminal, and answer
   * nothing here for it.
   *
   * Arm it beside `CliTerminal.answerNextPermission`, which is what answers it
   * there. Only ONE card is left: a second match is answered on the card as
   * usual, so an unanswered selector can never stall the rest of the run.
   */
  leaveNextPermissionToTerminal: (match: RegExp) => void;
  /** `connected` and `disconnected` entries, in order. */
  workspaceEvents: Array<{ state: string; name: string; root: string }>;
  /**
   * Every `navigate` instruction on the turns the watcher followed, in order.
   *
   * A turn the panel starts on its own never passes through the adapter, so
   * its navigations are readable here and nowhere else.
   */
  navigateHrefs: string[];
  /**
   * Every tool frame on the turns the watcher followed, start and end, in
   * stream order, across every turn including the ones the panel started on
   * its own. The ordering assertions read this.
   */
  toolEvents: LangyToolEvent[];
  /** Every turn the watcher observed, in the order it observed them. */
  turnIds: string[];
  /** The turns the panel started on its own, without a message from the test. */
  turnsStartedWithoutUs: (knownTurnIds: string[]) => string[];
  /** Wait for a turn other than the ones already known. */
  waitForNewTurn: (input: {
    knownTurnIds: string[];
    timeoutMs?: number;
  }) => Promise<string>;
  /**
   * Whether a turn's own question card was answered while its call was still
   * open.
   *
   * The question tool returns inside the turn when the answer reaches it in
   * time, and ends the turn when it does not, in which case the answer starts
   * a turn of its own. A step waiting for the work a card unlocks has to know
   * which of the two shapes it got, or it waits out its timeout on a turn that
   * already did that work.
   */
  cardAnsweredInsideTurn: (input: { turnId: string }) => Promise<boolean>;
  /**
   * Wait until no turn is in flight.
   *
   * Idle says the turn ended, not that its answer is already readable: the
   * fold and the message projection consume the same event on separate
   * queues, so `currentTurnId` can be null a moment before the answer row
   * exists. Ask for a turn's own messages with `turnId`, which waits for it.
   */
  waitForIdle: (timeoutMs?: number) => Promise<void>;
  /** The whole conversation, as the panel would render it. */
  transcript: () => Promise<string>;
  /**
   * The text of one turn's answer, or of the last answer stored when no turn
   * is named.
   */
  lastAssistantText: (input?: {
    turnId?: string;
    timeoutMs?: number;
  }) => Promise<string>;
  /**
   * One turn's answer as a judge reads it: the tool calls it made and what
   * they answered, then its reply.
   *
   * A turn the panel starts on its own never passes through the scenario
   * adapter, so nothing else puts its work in front of the judge. Feeding only
   * the reply leaves every claim in it looking ungrounded, which is a fact
   * about the harness and not about the answer.
   *
   * Name the turn with `turnId`. Without it the read takes whatever answer is
   * last right now, which after a turn that just ended can still be the answer
   * before it.
   */
  lastTurnMessages: (input?: {
    turnId?: string;
    timeoutMs?: number;
  }) => Promise<JudgeMessage[]>;
  stop: () => void;
}

/** One message of the stored conversation, as `langy.messages` returns it. */
export interface StoredMessage {
  id: string;
  role: string;
  parts: Array<Record<string, unknown>>;
}

/**
 * The words one stored part carries, or null when it carries none.
 *
 * A line said with the `say` tool is Langy's own prose, drawn where the call
 * happened, so it reads here exactly as a text part does. The empty text part
 * a turn ends on when every line was said that way carries nothing.
 */
export function partProse(part: Record<string, unknown>): string | null {
  const said =
    part.type === "tool-say"
      ? (part.input as { text?: unknown } | undefined)?.text
      : part.text;
  return typeof said === "string" && said.trim() !== "" ? said : null;
}

/**
 * What one settled tool call returned.
 *
 * A call that failed stores its reason in `errorText` and no output at all, so
 * reading the output alone hands the judge an empty string where the reason
 * for the failure was.
 */
export function toolOutputText(part: Record<string, unknown>): string {
  if (part.state === "output-error" && typeof part.errorText === "string") {
    return part.errorText;
  }
  return typeof part.output === "string"
    ? part.output
    : JSON.stringify(part.output ?? "");
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

/**
 * Everything a stored message says, in the order the panel draws it.
 *
 * A turn that ends on a `say` call is folded into a reply carrying that same
 * line, so the last line arrives twice. It is one line, and a judge reading it
 * twice grades a turn that repeated itself.
 */
export function storedProse(parts: Array<Record<string, unknown>>): string {
  return storedPassages(parts).join("\n");
}

/**
 * The same lines, each on its own, which is how the panel draws them and how a
 * judge reads a turn: one passage per `say`, in order.
 */
export function storedPassages(
  parts: Array<Record<string, unknown>>,
): string[] {
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

/**
 * One stored message as the judge reads it: the tool calls and their results
 * as their own messages, in the order the turn ran them, with the lines
 * written between them in front of the calls they introduce. The part type
 * carries the tool name as `tool-<name>`, which is the panel's own shape.
 *
 * This is the shape the streaming adapter builds for a turn the scenario
 * drives itself, so a turn the panel started on its own grades the same way.
 */
export function judgeMessages(message: {
  role: string;
  parts: Array<Record<string, unknown>>;
}): JudgeMessage[] {
  const messages: JudgeMessage[] = [];
  let narration: string[] = [];
  let batch: Array<Record<string, unknown>> = [];

  const flush = () => {
    if (batch.length === 0 && narration.length === 0) return;
    messages.push({
      role: "assistant",
      content: [
        ...narration.map((text) => ({ type: "text" as const, text })),
        ...batch.map((part) => ({
          type: "tool-call" as const,
          toolCallId: String(part.toolCallId),
          toolName: String(part.type).slice("tool-".length),
          input: part.input,
        })),
      ],
    });
    if (batch.length > 0) {
      messages.push({
        role: "tool",
        content: batch.map((part) => ({
          type: "tool-result" as const,
          toolCallId: String(part.toolCallId),
          toolName: String(part.type).slice("tool-".length),
          output: {
            type:
              part.state === "output-error"
                ? ("error-text" as const)
                : ("text" as const),
            value: toolOutputText(part),
          },
        })),
      });
    }
    narration = [];
    batch = [];
  };

  for (const part of message.parts) {
    const said = partProse(part);
    if (said !== null) {
      // A passage after a call opens the next stretch of work, so the calls
      // already gathered close here and keep their place in front of it.
      if (batch.length > 0) flush();
      // The reply a turn folds down to repeats the line it ended on.
      if (said.trim() !== narration[narration.length - 1]?.trim()) {
        narration.push(said);
      }
      continue;
    }
    if (isToolCallPart(part)) {
      batch.push(part);
    }
  }
  flush();

  // The turn's reply is the line it ended on, on its own.
  //
  // Every passage is already above, in front of the calls it introduces, so
  // the reply repeats one line rather than adding anything new: what it adds
  // is an ending. Two shapes went wrong without it. A turn that ended on a
  // tool call and then stored an empty text part, which is what the whole
  // llmops path does (two `navigate open` calls after the closing line),
  // handed the judge a transcript ending on a tool result with no reply at
  // all, and it was graded as a turn that trailed off. A turn that did end on
  // a passage got every passage of the turn joined into one reply, and a
  // judge asked whether the reply answers with concrete results or reads as a
  // work log fairly called twenty joined lines a log.
  const passages = storedPassages(message.parts);
  messages.push({
    role: "assistant",
    content: passages[passages.length - 1] ?? "",
  });
  return messages;
}

/**
 * The shell profile the shared terminal starts from.
 *
 * The terminal signs in through the login config alone: a project key in its
 * environment would make the command line act as the project, and a control
 * request is addressed to the person.
 */
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
    // The shims come before the command line's own shim dir, then whatever
    // the scenario built for itself, then the machine's PATH: a scenario's
    // stand-in wins, and everything it does not name resolves as it
    // normally would.
    `export PATH=${[shimDir, binDir, ...pathDirs]
      .map((dir) => JSON.stringify(dir))
      .join(":")}:"$PATH"`,
    "export FORCE_COLOR=0",
    "unset TRACEPARENT",
    // A folder a scenario shares is one of ours, whatever is above it.
    //
    // The folders live under the checkout's own `.claude/tmp`, and git looks
    // for a repository by walking up. A folder a scenario built WITHOUT one
    // answered every git command from this checkout instead: the no-repo
    // scenario, whose whole premise is a folder with no repository, ran
    // `git checkout -b` and created that branch on the lane, moving its HEAD
    // mid-run. A folder with no repository that sits inside a checkout IS
    // inside a repository, so the command line reading the parent was right
    // and the premise was the lie. The ceiling stops the walk at the folder
    // the scenarios live in: a folder with no repository of its own now has
    // none, and a folder with one is unaffected.
    `export GIT_CEILING_DIRECTORIES=${JSON.stringify(ceiling)}`,
    `exec node ${JSON.stringify(cliEntry)} langy --share-control`,
    "",
  ].join("\n");
}

/**
 * The stored answer of one turn.
 *
 * The answer message of a turn carries the turn id inside its own message id,
 * which is how the product keeps a turn's finalize idempotent. That is the one
 * link between a turn and its stored answer, so a read can wait for the right
 * message instead of taking whichever answer is last.
 */
export function answerOfTurn(
  messages: StoredMessage[],
  turnId: string,
): StoredMessage | null {
  return (
    messages.find(
      (message) => message.role === "assistant" && message.id.endsWith(turnId),
    ) ?? null
  );
}

/**
 * The line that says what the developer answered on a permission card.
 *
 * Written in the developer's own voice, and bracketed, so the judge reads it
 * as an action taken in the panel rather than as something said in the chat.
 */
export function permissionAnswerNote(ask: PermissionAsk): string {
  const where =
    ask.answeredIn === "terminal" ? "in the terminal" : "in the panel";
  if (ask.decision === "deny") {
    return `[developer denied ${where}: ${ask.summary}]`;
  }
  if (ask.decision === "allow_pattern") {
    const pattern = ask.pattern || ask.summary;
    return `[developer allowed the pattern \`${pattern}\` for this session ${where}: ${ask.summary}]`;
  }
  return `[developer allowed once ${where}: ${ask.summary}]`;
}

/**
 * What a scenario is told when the turn it was about to grade failed.
 *
 * A failed turn stores no answer of its own, and taking the answer before it
 * puts the previous turn in front of the judge, which reads as a pass. The run
 * ends here instead, with the reason the record holds.
 */
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

/**
 * The cards on the record that still need an answer, oldest first.
 *
 * A turn's live stream is one fetch with no reconnect, so a stream that ends
 * before its turn does takes every card raised after it: the card stays on
 * screen, nothing answers it, and the run sits there until a step times out.
 * That is not hypothetical, it is what happened when a folder connected, the
 * app restarted on the .env write, and the next card went up half a second
 * later.
 *
 * Every card is also written to the conversation's record, which no stream can
 * end, so the watcher reads the pending ones from there on each poll. The
 * fields a card carries are the same on the record as on the stream, so the
 * same two answer paths take either without knowing which it came from.
 */
export function pendingWaitDispatches({
  waits,
  answered,
}: {
  waits: RecordWait[];
  answered: ReadonlySet<string>;
}): Array<{ entry: StreamEntry; turnId: string; kind: string }> {
  const dispatches: Array<{
    entry: StreamEntry;
    turnId: string;
    kind: string;
  }> = [];
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

/**
 * Reads one turn's live stream and reports its entries.
 *
 * The suite's adapter already reads the stream of the turn it started, but a
 * folder that connects starts the NEXT turn on its own, and that turn's cards
 * have to be answered too. A second reader on the same turn is harmless: the
 * subscription is a read, and every answer is keyed on its wait id.
 */
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
    JSON.stringify({ json: { projectId: PROJECT_ID, conversationId, turnId } }),
  );
  const response = await fetch(
    `${APP_BASE}/api/sse/langy.onTurnStream?input=${input}`,
    {
      headers: { Cookie: cookie, Accept: "text/event-stream" },
      signal,
    },
  );
  if (!response.ok || !response.body) return;
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const handleFrame = (frame: string): void => {
    for (const line of frame.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const payload = trimmed.slice(5).trim();
      if (!payload) continue;
      try {
        const entry = JSON.parse(payload).json as StreamEntry;
        if (entry && typeof entry === "object") onEntry(entry);
      } catch {
        // A frame the suite does not understand is not this suite's business.
      }
    }
  };
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

/**
 * Watch the conversation and answer its cards as the developer would.
 *
 * The watcher polls the conversation for the turn in flight, opens that turn's
 * live stream, and answers every permission and question card it sees. It is
 * the user's hand: nothing it does is available to Langy, and every answer is
 * recorded so a test can assert what was asked before it asks a judge.
 */
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
  const workspaceEvents: Array<{
    state: string;
    name: string;
    root: string;
  }> = [];
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

  const answerPermission = async (
    entry: StreamEntry,
    turnId: string,
  ): Promise<void> => {
    const waitId = String(entry.waitId ?? "");
    if (!waitId || answeredWaits.has(waitId)) return;
    if (entry.status !== "pending") return;
    answeredWaits.add(waitId);
    const summary = String(entry.summary ?? "");
    // The terminal takes the first matching card, on its default option, which
    // is the session grant. Nothing is sent from here for that one.
    const inTerminal = leftToTerminal?.test(summary) === true;
    if (inTerminal) leftToTerminal = null;
    const decision = inTerminal ? "allow_pattern" : decide(summary);
    const ask: PermissionAsk = {
      waitId,
      callId: String(entry.callId ?? ""),
      summary,
      pattern: String(entry.pattern ?? ""),
      reason: String(entry.reason ?? ""),
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
        projectId: PROJECT_ID,
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

  const answerQuestionCard = async (
    entry: StreamEntry,
    turnId: string,
  ): Promise<void> => {
    const waitId = String(entry.waitId ?? "");
    if (!waitId || answeredWaits.has(waitId)) return;
    if (entry.status !== "pending") return;
    answeredWaits.add(waitId);
    const asked = (
      Array.isArray(entry.questions) ? entry.questions : []
    ) as QuestionAsk["questions"];
    const answers: Array<{ question: string; selected: string[] }> = [];
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
        projectId: PROJECT_ID,
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
          } else if (
            entry.type === "navigate" &&
            typeof entry.href === "string"
          ) {
            navigateHrefs.push(entry.href);
          } else if (entry.type === "tool") {
            const event = toolEventOf({ entry, turnId });
            if (event) toolEvents.push(event);
          } else if (entry.type === "local_workspace") {
            workspaceEvents.push({
              state: String(entry.state ?? ""),
              name: String(entry.name ?? ""),
              root: String(entry.root ?? ""),
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
    messages: Array<{
      id: string;
      role: string;
      parts: Array<Record<string, unknown>>;
    }>;
  } | null> => {
    const conversationId = adapter.state.conversationId;
    if (!conversationId) return null;
    const cookie = await getSessionCookie();
    return await trpcQuery({
      cookie,
      path: "langy.messages",
      input: { projectId: PROJECT_ID, conversationId },
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
      input: { projectId: PROJECT_ID, conversationId },
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
      } catch {
        // The conversation may not exist yet, or the app may be busy.
      }
      await sleep(1_000);
    }
  })();

  const messageText = (message: {
    role: string;
    parts: Array<Record<string, unknown>>;
  }): string => storedProse(message.parts);

  /**
   * Read a turn's answer, waiting for it to be stored.
   *
   * A turn that has just gone idle may have no answer row yet: the fold that
   * clears `currentTurnId` and the projection that writes the message consume
   * the same event on separate queues.
   */
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
        : (messages.filter((message) => message.role === "assistant").pop() ??
          null);
      // A named turn that stored its answer is readable whatever happened
      // after it. Without a name, the last answer is only this turn's answer
      // while the conversation has not failed.
      if (answer && (turnId || !snapshot?.lastError)) return answer;
      if (snapshot?.lastError) {
        throw new Error(
          turnFailureMessage({ turnId, failure: snapshot.lastError }),
        );
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
    turnsStartedWithoutUs: (knownTurnIds) =>
      turnIds.filter((id) => !knownTurnIds.includes(id)),
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
      return snapshot?.lastError
        ? `${body}\n\n### turn failed\n\n${snapshot.lastError}`
        : body;
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
        (part) =>
          part.type === "tool-question" && part.state === "output-available",
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
export async function getLocalWorkspace(
  conversationId: string,
): Promise<LocalWorkspaceStatus> {
  const cookie = await getSessionCookie();
  return await trpcQuery<LocalWorkspaceStatus>({
    cookie,
    path: "langy.getLocalWorkspace",
    input: { projectId: PROJECT_ID, conversationId },
  });
}

/** Remember, or forget, how Langy reaches this person's code. */
export async function setCodeAccessPreference(
  preference: "github" | null,
): Promise<void> {
  const cookie = await getSessionCookie();
  await trpcMutate({
    cookie,
    path: "langy.setCodeAccessPreference",
    input: { projectId: PROJECT_ID, preference },
  });
}

/** Close the shared folder the way the panel header chip closes it. */
export async function disconnectLocalWorkspace(
  conversationId: string,
): Promise<void> {
  const cookie = await getSessionCookie();
  await trpcMutate({
    cookie,
    path: "langy.disconnectLocalWorkspace",
    input: { projectId: PROJECT_ID, conversationId },
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
  return await waitFor({
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
  return await waitFor({
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
  return await new Promise((resolve, reject) => {
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
async function excludeFromGit({
  root,
  entry,
}: {
  root: string;
  entry: string;
}): Promise<void> {
  const excludeFile = path.join(root, ".git", "info", "exclude");
  await fs.mkdir(path.dirname(excludeFile), { recursive: true });
  const current = existsSync(excludeFile)
    ? await fs.readFile(excludeFile, "utf8")
    : "";
  if (current.split("\n").some((line) => line.trim() === entry)) return;
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

/**
 * Start the demo application from the shared folder, connected to the platform.
 *
 * It runs in its own terminal rather than as a child of the test, because
 * Langy restarts it through the folder and the test must not own the process
 * it is asserting about.
 *
 * The credentials go in the folder's own `.env`, which is where a developer
 * keeps them and where the demo reads them from. Exporting them only in this
 * launcher would leave them out of the shell Langy restarts the application
 * in, so the new process would come up with no way to reach the platform and
 * the agent would never register the change.
 *
 * The model key is one of them. Without it the demo's own tests cannot pass in
 * the shared folder whatever Langy writes, so a scenario that asks Langy to
 * run the checks would only ever prove that it tried.
 */
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
  sh("tmux", [
    "new-session",
    "-d",
    "-s",
    sessionName,
    "-x",
    "200",
    "-y",
    "60",
    "bash",
    script,
  ]);
  const capture = (): string =>
    spawnSync(
      "tmux",
      ["capture-pane", "-p", "-t", sessionName, "-S", "-3000"],
      { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 },
    ).stdout ?? "";
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

/**
 * Ask the demo application's own endpoint for one turn, from the branch that
 * is checked out.
 *
 * The scenarios reach the agent through the connection the SDK opens, which
 * says nothing about the HTTP endpoint the repository already had. A run
 * decorated the entry point in place and changed its return from the
 * dictionary the route reads to a string; the connection worked, every
 * scenario passed, and `POST /chat` raised on the first request.
 *
 * The application is started here rather than reused from Langy's own start:
 * what Langy starts is its choice, and a start such as `python -m app.main`
 * serves no HTTP at all, so there is no port to find. This starts it the way
 * the repository documents, on a free port, and stops it again.
 */
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
  const logPath = path.join(
    repo.root,
    "..",
    `chat-route-${Date.now().toString(36)}.log`,
  );
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
    } catch {
      // The process group is already gone, which is the state this wants.
    }
  };

  try {
    const deadline = Date.now() + startTimeoutMs;
    let healthy = false;
    while (!healthy && Date.now() < deadline) {
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
      } catch {
        // Not listening yet.
      }
      if (!healthy) await sleep(2_000);
    }
    if (!healthy) {
      return {
        status: 0,
        output: "",
        unreachable: `it never answered on ${base}/health within ${Math.round(startTimeoutMs / 1000)}s`,
        lines: tail(),
      };
    }
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
      output = String((JSON.parse(text) as { output?: unknown }).output ?? "");
    } catch {
      // A failed request answers with the server's own text, which the caller
      // reads out of the log rather than out of a field that is not there.
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
    headers: { "X-Auth-Token": apiKey, "X-Project-Id": PROJECT_ID },
  });
  if (!response.ok) return null;
  const body = (await response.json()) as unknown;
  const rows = Array.isArray(body)
    ? body
    : ((body as { agents?: unknown[]; data?: unknown[] }).agents ??
      (body as { data?: unknown[] }).data ??
      []);
  const named = (
    rows as Array<{
      id: string;
      name: string;
      parameters?: unknown;
      lastSeenAt?: string;
    }>
  ).filter((agent) => agent.name === name);
  // A folder shared from another machine leaves its own row behind, so the
  // newest connection is the one this run is asserting about.
  return (
    named.sort(
      (left, right) =>
        Date.parse(right.lastSeenAt ?? "") - Date.parse(left.lastSeenAt ?? ""),
    )[0] ?? null
  );
}

/**
 * The process ids listening on one port, out of `lsof -nP -iTCP:<port>`.
 *
 * `-t` is not used because the same output is parsed for a person reading the
 * log, and because an empty answer must read as "nothing there" rather than as
 * a parse that went wrong.
 */
export function listeningPids(lsofOutput: string): number[] {
  const pids = new Set<number>();
  for (const line of lsofOutput.split("\n").slice(1)) {
    const pid = Number.parseInt(line.trim().split(/\s+/)[1] ?? "", 10);
    if (Number.isInteger(pid)) pids.add(pid);
  }
  return [...pids];
}

/**
 * The process ids whose working directory is inside one folder, out of
 * `lsof -d cwd -Fpn`.
 *
 * The field output is a stream of records: `p<pid>`, then `f<fd>`, then
 * `n<path>`. A process is this run's when the path it names is the folder or
 * anything under it.
 */
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
  return (
    spawnSync("lsof", args, { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 })
      .stdout ?? ""
  );
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

/**
 * Everything this run started on the machine, ended.
 *
 * A background process Langy starts outlives the command line on purpose
 * (specs/typescript-sdk/cli-langy-share-control.feature), so the scenario has
 * to end it itself. Left alone, the demo server of one run holds its port and
 * serves a folder that the next run has already deleted.
 */
export function killScenarioProcesses({
  port,
  root,
}: {
  port?: number;
  root?: string;
}): void {
  const pids = new Set<number>();
  if (port) {
    for (const pid of listeningPids(
      lsof(["-nP", `-iTCP:${port}`, "-sTCP:LISTEN"]),
    )) {
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
  return ["## Terminal", "", "```", terminal.capture().trim(), "```"].join(
    "\n",
  );
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
