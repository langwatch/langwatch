import { execa } from "execa";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { appRoot } from "./app-dir.ts";
import type { EventBus } from "./event-bus.ts";
import type { LangwatchPaths } from "../shared/paths.ts";
import { execAndPipe } from "./_pipe-to-bus.ts";

/**
 * Ensure langwatch/node_modules exists + start:prepare:files has run, both of
 * which are prerequisites for `pnpm run prisma:migrate` and `pnpm run start:app`.
 *
 * Runs INSIDE the relocated app tree (LANGWATCH_HOME/app/langwatch/) — see
 * services/app-dir.ts for why we relocate out of node_modules.
 */
export async function ensureLangwatchDeps(ctx: { paths: LangwatchPaths }, bus: EventBus): Promise<void> {
  const langwatchDir = locateLangwatchDir();
  if (!langwatchDir) throw new Error("langwatch app dir not found");

  const nodeModulesPath = join(langwatchDir, "node_modules");
  const distPath = join(langwatchDir, "dist");
  const prismaClientPath = join(nodeModulesPath, ".prisma", "client", "index.js");
  const lockfilePath = join(langwatchDir, "pnpm-lock.yaml");
  const hashFile = join(nodeModulesPath, ".install-hash");

  const distAlreadyBuilt = existsSync(join(distPath, "client"));
  // Hash key combines the lockfile + package.json — either changing means
  // we need to re-run install. Use sha256 (not just mtime) because rsync
  // during ensureAppDir resets mtimes.
  const installKey = computeInstallKey(lockfilePath, join(langwatchDir, "package.json"));

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

  if (installFresh && existsSync(prismaClientPath) && distAlreadyBuilt) {
    return;
  }

  bus.emit({ type: "starting", service: "prepare:langwatch" as never });
  const start = Date.now();

  // We use `pnpm -C <dir>` instead of `cwd: langwatchDir` because pnpm's
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

  if (!installFresh) {
    // Always install with `--prod=false`. We tried `--prod` for the
    // prebuilt-dist path to save ~50 devDependencies (vite, esbuild,
    // vitest, playwright, etc.), but it turned up two real-world
    // breakages on dogfood:
    //   1. .prisma/client/ never materialized → langwatch app crashed
    //      on `Cannot find module '.prisma/client/index'`.
    //   2. tsx's --tsconfig path-alias resolver failed to map `~/...`
    //      imports inside src/tasks/* → `Cannot find module '~/server/...'`.
    // The transitive deps that tsx + prisma + workers need at runtime
    // overlap unpredictably with langwatch's devDependencies, and
    // chasing each is a losing game. Disk hit is acceptable; reliability
    // wins.
    await execAndPipe(
      bus,
      "prepare:langwatch",
      pnpm.command,
      [...pnpm.args, "-C", langwatchDir, "install", "--prod=false", "--frozen-lockfile"],
    );
    writeFileSync(hashFile, installKey);
  }

  // pnpm install does NOT auto-generate the prisma client. Run it whenever
  // the generated client is missing. The full-build path below (when
  // !distAlreadyBuilt) ALSO covers this via start:prepare:files →
  // prisma:generate:typescript, so we only need the explicit call on the
  // prebuilt-dist path.
  if (distAlreadyBuilt && !existsSync(prismaClientPath)) {
    await execAndPipe(
      bus,
      "prepare:langwatch",
      pnpm.command,
      [...pnpm.args, "-C", langwatchDir, "exec", "prisma", "generate"],
    );
  }

  // Skip the build step entirely when dist/client/ is already present.
  // Published npm tarballs ship dist/ pre-built (see
  // .github/workflows/npx-server-publish.yml), so end users hit `pnpm install`
  // + `prisma generate` and nothing else. The build only runs for
  // `pnpm pack`-driven local dogfood and dev checkouts where dist/
  // doesn't exist yet.
  if (!distAlreadyBuilt) {
    // Full prod build: start:prepare:files → build:scenario-child-process → vite build.
    // start:prepare:files generates Prisma client, Zod types, SDK versions,
    // langevals types (from the source committed in langevals/ts-integration/),
    // and the mcp-server bundle. vite build emits dist/client/ for static serving.
    // Without dist/client/, every UI route returns 404 and only /api/* works.
    await execAndPipe(
      bus,
      "prepare:langwatch",
      pnpm.command,
      [...pnpm.args, "-C", langwatchDir, "run", "build"],
      {
        env: {
          ...process.env,
          NODE_ENV: "production",
        },
      },
    );
  }

  bus.emit({ type: "healthy", service: "prepare:langwatch" as never, durationMs: Date.now() - start });
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
export async function resolvePnpm(paths?: LangwatchPaths): Promise<{ command: string; args: string[] }> {
  if (paths) {
    const bundled = join(paths.bin, "pnpm");
    if (existsSync(bundled)) return { command: bundled, args: [] };
  }
  const direct = await execa("pnpm", ["--version"], { reject: false });
  if (direct.exitCode === 0) return { command: "pnpm", args: [] };
  const { exitCode } = await execa("corepack", ["--version"], { reject: false });
  if (exitCode === 0) return { command: "corepack", args: ["pnpm"] };
  throw new Error("pnpm not found in <bin>/pnpm, on PATH, or via corepack");
}

export function locateLangwatchDir(): string | null {
  // appRoot() returns the relocated tree (LANGWATCH_HOME/app) once
  // ensureAppDir has run, or the dev workspace fallback otherwise.
  const dir = join(appRoot(), "langwatch");
  return existsSync(join(dir, "package.json")) ? dir : null;
}
