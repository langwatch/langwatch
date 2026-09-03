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

/**
 * The argv for the workspace install both boot passes run — dev-deps-included
 * before the build, prod-only after it. One builder rather than two inline
 * arrays so the two invariants an end-user install depends on cannot drift
 * apart silently: `--frozen-lockfile` (the install is reproducible or it
 * fails) and the `...` filter (the SDK, skills compiler and test suites never
 * install on a customer machine). Exported for tests — the spec scenario
 * "The install still refuses to drift from the lockfile" binds to this.
 */
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
  // apps/api and apps/worker each declare `tsx` as a production dependency and
  // run their entry point from source, and the ClickHouse migrations are read
  // from the task's own directory rather than a copy under dist/server. What a
  // build still has to produce is the browser bundle the API process serves,
  // and index.html is the file that proves it landed whole: an interrupted
  // vite build leaves assets without a shell.
  const distAlreadyBuilt = existsSync(join(distPath, "client", "index.html"));
  // Hash key combines the lockfile + workspace definition + package.json —
  // any of them changing means we need to re-run install. Use sha256 (not
  // just mtime) because rsync during ensureAppDir resets mtimes. The sequence
  // tag versions the whole install recipe: bumping it re-runs the cycle on
  // existing installs, which is how trees installed before the prod-prune
  // step existed get pruned.
  // seq3: re-run on installs whose tree predates the tarball shipping the
  // workspace packages (3.6.0) — their pnpm links dangled and the member
  // packages' own dependencies were never installed.
  // seq4: re-run on installs made against the old per-app lockfile. Those
  // trees have no root-level workspace at all, so the filtered install below
  // would otherwise be skipped as fresh and leave the app on a layout the
  // rest of this function no longer expects.
  // seq5: re-run on installs whose tree predates the split into apps/api,
  // apps/worker and apps/ui. Those trees are keyed on the monolith's manifest
  // and hold its bundles, neither of which exists now.
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
  const start = Date.now();

  // We use `pnpm -C <dir>` instead of a cwd because pnpm's
  // workspace-aware mode resolves the workspace ROOT package.json when
  // invoked through corepack (or sometimes plain pnpm too) — leading to
  // "Missing script: build. Did you mean pnpm run build:cli?" because
  // build:cli is on root. `-C` is the official "change to package dir
  // and only that dir" flag.
  //
  // For the binary, prefer `pnpm` directly on PATH when present (CI via
  // pnpm/action-setup, end users via corepack-shimmed PATH) and fall back
  // to `corepack pnpm`. corepack is *not* the primary because `corepack
  // pnpm -C <dir>` swallows the `-C` flag in some cases and pnpm
  // re-resolves cwd to its own dir, defeating the workspace-isolation
  // intent above. See resolvePnpm() below.
  const pnpm = await resolvePnpm(ctx.paths);

  // npm pack unconditionally drops .npmrc from published artifacts (it often
  // carries auth tokens), so the repo's .npmrc never reaches an npx install.
  // Recreate it before the first install: without these hoists OpenTelemetry's
  // ESM loader shims land deep in the virtual store and its instrumentation
  // cannot patch them.
  //
  // At the ROOT, not in an application directory: hoisting is a property of the install
  // root, and since ADR-076 that is the tarball root. A copy written into
  // langwatch/ would be read for nothing.
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
    // Install everything, dev dependencies included, because the steps that
    // follow genuinely need them: prisma generate needs the prisma CLI's
    // build tooling and the full build needs vite. Installing with `--prod`
    // up front was tried once and broke exactly those two steps. The dev
    // dependencies come OUT again below (the --prod pass, after the build),
    // which is the same order the production Dockerfile uses — the pruned
    // tree it produces is what every helm and docker deployment runs.
    //
    // `--filter` is what keeps an end user's install to the app: the tarball
    // ships the whole workspace definition, so an unfiltered install would
    // also pull the TypeScript SDK, the skills compiler and the e2e suites,
    // none of which the server ever runs. The trailing `...` selects the
    // app AND everything it depends on, which is how the workspace members
    // under packages/ and mcp/typescript/ still get installed.
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
    // Full prod build, in the two steps the image runs: the root's
    // start:prepare:files (Prisma client, langevals evaluator types, the
    // TypeScript SDK's dist, the mcp-server bundle, the langy skill
    // catalogue), then the browser bundle. `--filter "@langwatch/ui..."`
    // builds the UI's workspace dependencies first, in topological order.
    // Without dist/client every browser route 404s and only /api/* answers.
    // Neither Node process is built: both run their entry point through tsx.
    await execAndPipe(bus, "prepare:langwatch", pnpm.command, [
      ...pnpm.args,
      "-C",
      rootDir,
      "run",
      "start:prepare:files",
    ]);
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

  // Take the dev dependencies back out, the way the production Dockerfile
  // does after ITS build (install → build → prod-only pass → prisma generate).
  // This is what drops vite, vitest, playwright and the rest of the
  // build tooling from the tree the server actually runs — on the order of a
  // gigabyte — while prisma stays, because migrations run through the prisma
  // CLI and apps/api declares it as a runtime dependency. tsx stays for the
  // same reason: apps/api and apps/worker boot their entry point through it,
  // so it is a production dependency of both rather than build tooling.
  //
  // A re-install with `--prod` rather than `pnpm prune --prod`: prune has no
  // `--filter`, so in a workspace it reasons about every project rather than
  // the one subtree we installed. A filtered `--prod` install converges on
  // the same prod-only tree and stays scoped to the app.
  //
  // ONLY on the relocated copy under LANGWATCH_HOME. A dev checkout runs the
  // CLI against its own working tree, and pruning that would strip the
  // developer's test and build tooling out from under them.
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

  // Workspace members living OUTSIDE langwatch/ (mcp-server, packages/*)
  // cannot reach apps/api/node_modules by walking up, so their declared
  // peerDependencies resolve nowhere in the relocated tree. Materialize
  // each peer as a member-local link to the app's resolved instance —
  // the "consumer provides the peer" contract made explicit on disk.
  // Only on the relocated copy: a dev checkout resolves these through its
  // own root-workspace install.
  if (shouldPruneToProd(apiDir, ctx.paths)) {
    linkExternalMemberPeers(appRoot());
  }

  // pnpm quietly tolerates a workspace member listed in the lockfile whose
  // directory is absent: install exits 0 and leaves dangling @langwatch/*
  // links, and the first runtime import dies minutes later inside a
  // migration. Turn that into an install-time failure that names the
  // packaging gap. (Exactly how 3.6.0 shipped: both .npmignore files still
  // excluded the app's packages/ after runtime packages moved in.)
  assertWorkspaceLinksResolve(nodeModulesPath);

  // Written LAST so an interrupted run never records success: any of the
  // steps above dying leaves the old key (or none) and the next boot redoes
  // the cycle.
  writeFileSync(hashFile, installKey);

  bus.emit({
    type: "healthy",
    service: "prepare:langwatch" as never,
    durationMs: Date.now() - start,
  });
}

/**
 * For every app-workspace member outside langwatch/, link its declared
 * peerDependencies to the app's own resolved instances. Runtime imports in
 * those members (zod in @langwatch/langy, @opentelemetry/api in
 * @langwatch/handled-error) are peers on purpose: both packages must share
 * the CONSUMER's instance — a second copy of either breaks it (zod schemas
 * from two majors cannot merge; a second otel api loses the global
 * registrations). The links make the relocated tree resolve them the way
 * every other deployment already does. Idempotent; skips peers the app
 * doesn't carry. Exported for tests.
 */
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

/**
 * Whether `prisma generate` has produced a client in any of these trees. Under
 * pnpm the generated files live inside the virtual store
 * (node_modules/.pnpm/@prisma+client@<ver>/node_modules/.prisma/client/), NOT
 * the top-level node_modules/.prisma/ that npm and yarn use. The old
 * top-level-only check could never pass on a pnpm tree, so every single boot
 * re-ran the entire prepare step — install, build, generate — for minutes,
 * believing the client was missing.
 *
 * Takes several roots because ADR-076 moved the store. The install root is now
 * the workspace root, so the store is at <root>/node_modules/.pnpm and
 * an application's node_modules holds only symlinks — checking that alone
 * reintroduced exactly the bug described above, silently, for every npx user.
 * Both are checked: the root for current trees, the application's for ones
 * installed before the merge. Exported for tests.
 */
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

/**
 * Resolve which `pnpm` to use for our outer invocations (the `pnpm install`,
 * `pnpm run build`, `pnpm run prisma:migrate` calls we make from
 * services/{node-deps,migrate,langwatch,langwatch-workers}.ts).
 *
 * Order:
 *  1. The bundled pnpm we install as a predep into `<paths.bin>/pnpm` —
 *     see predeps/pnpm.ts. This is the canonical end-user path.
 *     Self-contained, no corepack dependency, deterministic version.
 *  2. Direct `pnpm` on PATH — for dev checkouts and CI runners that
 *     already have pnpm/action-setup or a global pnpm install.
 *  3. `corepack pnpm` — last-ditch fallback for environments with
 *     corepack but no pnpm on PATH and no bundled pnpm yet.
 *
 * The bundled pnpm wins over PATH-pnpm so the version is whatever the
 * predep pinned, regardless of the user's globals. ctx.paths.bin is also
 * prepended to PATH for spawned children, so any nested `pnpm` call inside
 * langwatch's package.json scripts (e.g. `sh -c 'pnpm prisma migrate
 * deploy'`) resolves to the same bundled binary.
 *
 * Pass `paths` from any caller that has runtime context; callers who
 * don't (legacy ensureLangwatchDeps before predeps run) skip step 1.
 */
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

/**
 * The three deployables, in the relocated tree.
 *
 * `appRoot()` returns LANGWATCH_HOME/app once ensureAppDir has run, or the dev
 * workspace fallback otherwise. Each is located separately because each is a
 * separate process with its own work: apps/api runs both schema migrations and
 * serves everything (including the browser bundle apps/ui builds), and
 * apps/worker runs the background stack.
 */
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
