import { execa } from "execa";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, sep } from "node:path";
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
  const lockfilePath = join(langwatchDir, "pnpm-lock.yaml");
  const hashFile = join(nodeModulesPath, ".install-hash");

  const distAlreadyBuilt = existsSync(join(distPath, "client"));
  // Hash key combines the lockfile + package.json — either changing means
  // we need to re-run install. Use sha256 (not just mtime) because rsync
  // during ensureAppDir resets mtimes. The sequence tag versions the whole
  // install recipe: bumping it re-runs the cycle on existing installs, which
  // is how trees installed before the prod-prune step existed get pruned.
  const installKey = `${computeInstallKey(lockfilePath, join(langwatchDir, "package.json"))}|seq2-prod-pruned`;

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

  if (installFresh && prismaClientGenerated(nodeModulesPath) && distAlreadyBuilt) {
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
    // Install everything, dev dependencies included, because the steps that
    // follow genuinely need them: prisma generate needs the prisma CLI's
    // build tooling and the full build needs vite. Installing with `--prod`
    // up front was tried once and broke exactly those two steps. The dev
    // dependencies come OUT again below (prune --prod, after the build),
    // which is the same order the production Dockerfile uses — the pruned
    // tree it produces is what every helm and docker deployment runs.
    await execAndPipe(
      bus,
      "prepare:langwatch",
      pnpm.command,
      [...pnpm.args, "-C", langwatchDir, "install", "--prod=false", "--frozen-lockfile"],
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

  // Take the dev dependencies back out, the way the production Dockerfile
  // does after ITS build (install → build → prune --prod → prisma generate).
  // This is what drops vite, vitest, playwright, biome and the rest of the
  // build tooling from the tree the server actually runs — on the order of a
  // gigabyte — while tsx and prisma stay, because they are runtime
  // dependencies here (the server boots through tsx, migrations run through
  // the prisma CLI) and are declared as such.
  //
  // ONLY on the relocated copy under LANGWATCH_HOME. A dev checkout runs the
  // CLI against its own working tree, and pruning that would strip the
  // developer's test and build tooling out from under them.
  if (shouldPruneToProd(langwatchDir, ctx.paths)) {
    await execAndPipe(
      bus,
      "prepare:langwatch",
      pnpm.command,
      [...pnpm.args, "-C", langwatchDir, "prune", "--prod"],
      { env: { ...process.env, CI: "true" } },
    );
  }

  // pnpm install does not auto-generate the prisma client, and prune removes
  // a generated one (it is not a declared dependency, so prune sees it as
  // extraneous — the Dockerfile regenerates after pruning for the same
  // reason). One post-prune generate covers every path that needs it.
  if (!prismaClientGenerated(nodeModulesPath)) {
    await execAndPipe(
      bus,
      "prepare:langwatch",
      pnpm.command,
      [...pnpm.args, "-C", langwatchDir, "exec", "prisma", "generate"],
    );
  }

  // Written LAST so an interrupted run never records success: any of the
  // steps above dying leaves the old key (or none) and the next boot redoes
  // the cycle.
  writeFileSync(hashFile, installKey);

  bus.emit({ type: "healthy", service: "prepare:langwatch" as never, durationMs: Date.now() - start });
}

/**
 * Whether `prisma generate` has produced a client in this tree. Under pnpm
 * the generated files live inside the virtual store
 * (node_modules/.pnpm/@prisma+client@<ver>/node_modules/.prisma/client/), NOT
 * the top-level node_modules/.prisma/ that npm and yarn use. The old
 * top-level-only check could never pass on a pnpm tree, so every single boot
 * re-ran the entire prepare step — install, build, generate — for minutes,
 * believing the client was missing. Exported for tests.
 */
export function prismaClientGenerated(nodeModulesPath: string): boolean {
  if (existsSync(join(nodeModulesPath, ".prisma", "client", "index.js"))) {
    return true;
  }
  const pnpmDir = join(nodeModulesPath, ".pnpm");
  if (!existsSync(pnpmDir)) return false;
  for (const entry of readdirSync(pnpmDir)) {
    if (!entry.startsWith("@prisma+client@")) continue;
    if (
      existsSync(
        join(pnpmDir, entry, "node_modules", ".prisma", "client", "index.js"),
      )
    ) {
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
