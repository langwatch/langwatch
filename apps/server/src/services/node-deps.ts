import { createHash } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, relative, sep } from "node:path";
import { execa } from "execa";
import type { LangwatchPaths } from "../shared/paths.ts";
import { execAndPipe } from "./_pipe-to-bus.ts";
import { appRoot } from "./app-dir.ts";
import type { EventBus } from "./event-bus.ts";
import { nowInstant } from "@langwatch/time";

/**
 * The workspace name of the langwatch app, as declared in
 * apps/api/package.json. Used to filter the install down to the apps and their
 * dependencies. It was plain `langwatch` until ADR-076 — the same name the
 * published TypeScript SDK uses, which is exactly why it had to change before
 * the two could live in one workspace.
 */
export const APP_PACKAGE_NAMES = [
  "@langwatch/platform-api",
  "@langwatch/worker",
  "@langwatch/ui",
  "@langwatch/tasks",
] as const;

// Workspace install argv for dev and prod passes; one builder keeps invariants from drifting.
export function workspaceInstallArgs(rootDir: string, { prod }: { prod: boolean }): string[] {
  return [
    "-C",
    rootDir,
    "install",
    prod ? "--prod" : "--prod=false",
    "--frozen-lockfile",
    // One filter per deployable, each with the trailing `...` that pulls in
    // its workspace dependencies. Three, because the three dependency subtrees
    // are not subsets of one another: the browser bundle's build tooling is not
    // in the API's closure, and the worker's queue stack is not in the UI's.
    ...APP_PACKAGE_NAMES.flatMap((name) => ["--filter", `${name}...`]),
  ];
}

/**
 * Ensure the applications' node_modules exist and `start:prepare:files` has
 * run, both of which are prerequisites for the migration tasks and for
 * `pnpm run start` in apps/api and apps/worker.
 *
 * Runs INSIDE the relocated tree (LANGWATCH_HOME/app/) — see
 * services/app-dir.ts for why we relocate out of node_modules.
 */
export async function ensureLangwatchDeps(
  ctx: { paths: LangwatchPaths },
  bus: EventBus,
): Promise<void> {
  const apiDir = locateApiDir();
  if (!apiDir) throw new Error("langwatch api dir not found");
  const uiDir = locateUiDir();
  if (!uiDir) throw new Error("langwatch ui dir not found");

  // The install runs from the tarball ROOT. Since ADR-076 the repo is a single
  // pnpm workspace, so the lockfile and the workspace definition live at the
  // root and each application is one member of it.
  const rootDir = appRoot();
  const nodeModulesPath = join(apiDir, "node_modules");
  // Where pnpm's virtual store actually lives since ADR-076.
  const rootNodeModules = join(rootDir, "node_modules");
  const distPath = join(uiDir, "dist");
  const lockfilePath = join(rootDir, "pnpm-lock.yaml");
  const workspacePath = join(rootDir, "pnpm-workspace.yaml");
  const hashFile = join(nodeModulesPath, ".install-hash");

  // One artifact, not five. The two Node processes are no longer bundled —
  // apps/api and apps/worker run their entry point from source through Node's
  // own type stripping, and the ClickHouse migrations are read
  // from the task's own directory rather than a copy under dist/server. What a
  // build still has to produce is the browser bundle the API process serves,
  // and index.html is the file that proves it landed whole: an interrupted
  // vite build leaves assets without a shell.
  const distAlreadyBuilt = existsSync(join(distPath, "client", "index.html"));
  // Install key from lockfile + workspace + package.json; seq5 forces re-run on old tree layouts.
  const installKey = `${computeInstallKey(lockfilePath, workspacePath, join(apiDir, "package.json"))}|seq5-three-applications`;

  // Top-level symlinks are the strongest "install completed" signal:
  // pnpm creates `.bin/` and direct package entries LAST after populating
  // `.pnpm/`. If a previous install was interrupted between those two
  // phases (CTRL-C, OOM, fs flush mid-write), `.pnpm/` looks fine but
  // `.bin/prisma` is missing — and `pnpm prisma migrate deploy` then
  // dies with `Command "prisma" not found`. Including this in the
  // skip-gate keeps that whole class of bug from re-armoring.
  const topLevelLinksOk = existsSync(join(nodeModulesPath, ".bin", "prisma"));
  const cachedHash = existsSync(hashFile) ? readFileSync(hashFile, "utf8").trim() : null;
  const installFresh = topLevelLinksOk && cachedHash === installKey;

  if (installFresh && prismaClientGenerated(rootNodeModules, nodeModulesPath) && distAlreadyBuilt) {
    return;
  }

  bus.emit({ type: "starting", service: "prepare:langwatch" as never });
  const start = nowInstant().epochMilliseconds;

  // Use pnpm -C to isolate package dir; prefer pnpm on PATH over corepack shimmed one.
  const pnpm = await resolvePnpm(ctx.paths);

  // Recreate .npmrc (npm pack strips it). Hoisting at root, not in application directories.
  const npmrcPath = join(rootDir, ".npmrc");
  if (!existsSync(npmrcPath)) {
    writeFileSync(
      npmrcPath,
      [
        "# Recreated by @langwatch/server (npm pack always strips .npmrc).",
        "# Mirrors the repo's root .npmrc.",
        "public-hoist-pattern[]=*import-in-the-middle*",
        "public-hoist-pattern[]=*require-in-the-middle*",
        "",
      ].join("\n"),
    );
  }

  if (!installFresh) {
    // Install dev deps first (prisma and vite need them), then prune in the second pass.
    // --filter keeps install to app + dependencies only, excluding SDK/compiler/tests.
    await execAndPipe(bus, "prepare:langwatch", pnpm.command, [
      ...pnpm.args,
      ...workspaceInstallArgs(rootDir, { prod: false }),
    ]);
  }

  // Skip the build step entirely when apps/ui/dist/client/ is already present.
  // Published npm tarballs ship dist/ pre-built (see
  // .github/workflows/npx-server-publish.yml), so end users hit `pnpm install`
  // + `prisma generate` and nothing else. The build only runs for
  // `pnpm pack`-driven local dogfood and dev checkouts where dist/
  // doesn't exist yet.
  if (!distAlreadyBuilt) {
    // Full prod build, in the three steps the image runs: start:prepare:files
    // (Prisma client, langevals evaluator types, the langy skill catalogue),
    // ensure:built (the SDK and mcp-server bundles, which no --filter closure
    // below reaches), then the browser bundle — without dist/client every
    // browser route 404s. Neither Node process is built; both run from source.
    for (const script of ["start:prepare:files", "ensure:built"]) {
      await execAndPipe(bus, "prepare:langwatch", pnpm.command, [
        ...pnpm.args,
        "-C",
        rootDir,
        "run",
        script,
      ]);
    }
    await execAndPipe(
      bus,
      "prepare:langwatch",
      pnpm.command,
      [...pnpm.args, "-C", rootDir, "--filter", "@langwatch/ui...", "run", "build"],
      {
        env: {
          ...process.env,
          NODE_ENV: "production",
        },
      },
    );
  }

  // Prune dev dependencies (vite, vitest, playwright); keep prisma for migrations.
  // Only on relocated copy; dev checkout keeps its own build tooling intact.
  if (shouldPruneToProd(apiDir, ctx.paths)) {
    await execAndPipe(
      bus,
      "prepare:langwatch",
      pnpm.command,
      [...pnpm.args, ...workspaceInstallArgs(rootDir, { prod: true })],
      { env: { ...process.env, CI: "true" } },
    );
  }

  // pnpm install does not auto-generate the prisma client, and prune removes
  // a generated one (it is not a declared dependency, so prune sees it as
  // extraneous — the Dockerfile regenerates after pruning for the same
  // reason). One post-prune generate covers every path that needs it.
  if (!prismaClientGenerated(rootNodeModules, nodeModulesPath)) {
    await execAndPipe(bus, "prepare:langwatch", pnpm.command, [
      ...pnpm.args,
      "-C",
      apiDir,
      "exec",
      "prisma",
      "generate",
      "--config",
      "./prisma.config.ts",
    ]);
  }

  // Link external members' peers to app-resolved instances; only on relocated copy.
  if (shouldPruneToProd(apiDir, ctx.paths)) {
    linkExternalMemberPeers(appRoot());
  }

  // Fail at install time if workspace member links are missing; prevent runtime import errors.
  assertWorkspaceLinksResolve(nodeModulesPath);

  // Written LAST so an interrupted run never records success: any of the
  // steps above dying leaves the old key (or none) and the next boot redoes
  // the cycle.
  writeFileSync(hashFile, installKey);

  bus.emit({
    type: "healthy",
    service: "prepare:langwatch" as never,
    durationMs: nowInstant().epochMilliseconds - start,
  });
}

// Link external members' peerDependencies to app-resolved instances; idempotent.
export function linkExternalMemberPeers(appRootDir: string): string[] {
  const appNodeModules = join(appRootDir, "apps", "api", "node_modules");
  const memberDirs = [
    join(appRootDir, "mcp", "typescript"),
    ...listDirs(join(appRootDir, "packages")),
  ];
  const linked: string[] = [];
  for (const memberDir of memberDirs) {
    const pkgPath = join(memberDir, "package.json");
    if (!existsSync(pkgPath)) continue;
    let peers: string[] = [];
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as {
        peerDependencies?: Record<string, string>;
      };
      peers = Object.keys(pkg.peerDependencies ?? {});
    } catch {
      continue;
    }
    for (const name of peers) {
      const target = join(appNodeModules, ...name.split("/"));
      if (!existsSync(target)) continue;
      const linkPath = join(memberDir, "node_modules", ...name.split("/"));
      // existsSync follows symlinks, so it says false for a dangling link
      // whose directory entry is still there — and symlinkSync would then
      // die with EEXIST. lstat sees the entry itself: keep it when it
      // resolves, replace it when it dangles (a re-install after an app
      // tree wipe leaves exactly that).
      if (lstatSafely(linkPath)) {
        if (existsSync(linkPath)) continue;
        // unlinkSync, not rmSync: rm stats the TARGET, and on a dangling
        // link it silently does nothing — unlink removes the entry itself.
        unlinkSync(linkPath);
      }
      mkdirSync(dirname(linkPath), { recursive: true });
      symlinkSync(relative(dirname(linkPath), target), linkPath);
      linked.push(`${basename(memberDir)}:${name}`);
    }
  }
  return linked;
}

function listDirs(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .map((entry) => join(dir, entry))
    .filter((p) => existsSync(join(p, "package.json")));
}

function lstatSafely(path: string): boolean {
  try {
    lstatSync(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Every @langwatch/* entry in node_modules must resolve to a real directory.
 * A dangling link means the app tree is missing a workspace package the
 * lockfile promised — a packaging bug in the published artifact, not
 * something a retry can fix. Exported for tests.
 */
export function assertWorkspaceLinksResolve(nodeModulesPath: string): void {
  const scopeDir = join(nodeModulesPath, "@langwatch");
  if (!existsSync(scopeDir)) return;
  const dangling: string[] = [];
  for (const entry of readdirSync(scopeDir)) {
    // existsSync follows symlinks: false for a link whose target is gone.
    if (!existsSync(join(scopeDir, entry, "package.json"))) {
      dangling.push(`@langwatch/${entry}`);
    }
  }
  if (dangling.length > 0) {
    throw new Error(
      `app tree is missing workspace packages: ${dangling.join(", ")}. ` +
        `The published artifact did not ship them — this is a packaging bug in @langwatch/server; ` +
        `please report it at https://github.com/langwatch/langwatch/issues`,
    );
  }
}

// Check prisma client in both pnpm virtual store and top-level node_modules.
export function prismaClientGenerated(...nodeModulesPaths: string[]): boolean {
  return nodeModulesPaths.some(prismaClientGeneratedIn);
}

function prismaClientGeneratedIn(nodeModulesPath: string): boolean {
  if (existsSync(join(nodeModulesPath, ".prisma", "client", "index.js"))) {
    return true;
  }
  const pnpmDir = join(nodeModulesPath, ".pnpm");
  if (!existsSync(pnpmDir)) return false;
  for (const entry of readdirSync(pnpmDir)) {
    if (!entry.startsWith("@prisma+client@")) continue;
    if (existsSync(join(pnpmDir, entry, "node_modules", ".prisma", "client", "index.js"))) {
      return true;
    }
  }
  return false;
}

/**
 * Prune is for the relocated install under LANGWATCH_HOME only. Exported for
 * tests; the path comparison is the entire decision.
 */
export function shouldPruneToProd(
  langwatchDir: string,
  paths: Pick<LangwatchPaths, "app">,
): boolean {
  return langwatchDir === paths.app || langwatchDir.startsWith(paths.app + sep);
}

function computeInstallKey(...files: string[]): string {
  const h = createHash("sha256");
  for (const f of files) {
    if (existsSync(f)) h.update(readFileSync(f));
    h.update("\n--\n");
  }
  return h.digest("hex");
}

// Resolve pnpm: bundled > PATH > corepack fallback. Prefer deterministic bundled version.
export async function resolvePnpm(
  paths?: LangwatchPaths,
): Promise<{ command: string; args: string[] }> {
  if (paths) {
    const bundled = join(paths.bin, "pnpm");
    if (existsSync(bundled)) return { command: bundled, args: [] };
  }
  const direct = await execa("pnpm", ["--version"], { reject: false });
  if (direct.exitCode === 0) return { command: "pnpm", args: [] };
  const { exitCode } = await execa("corepack", ["--version"], {
    reject: false,
  });
  if (exitCode === 0) return { command: "corepack", args: ["pnpm"] };
  throw new Error("pnpm not found in <bin>/pnpm, on PATH, or via corepack");
}

// Locate deployable app directories (api, worker, ui, tasks) in relocated tree.
function locateAppDir(name: "api" | "worker" | "ui" | "tasks"): string | null {
  const dir = join(appRoot(), "apps", name);
  return existsSync(join(dir, "package.json")) ? dir : null;
}

export function locateApiDir(): string | null {
  return locateAppDir("api");
}

export function locateWorkerDir(): string | null {
  return locateAppDir("worker");
}

export function locateUiDir(): string | null {
  return locateAppDir("ui");
}

/** The task-launcher process — prisma-migrate, clickhouse-migrate, lwql-provision. */
export function locateTasksDir(): string | null {
  return locateAppDir("tasks");
}
