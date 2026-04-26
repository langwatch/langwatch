import { execa } from "execa";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { RuntimeContext } from "../shared/runtime-contract.ts";
import type { EventBus } from "./event-bus.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Ensure langwatch/node_modules exists + start:prepare:files has run, both of
 * which are prerequisites for `pnpm run prisma:migrate` and `pnpm run start:app`.
 *
 * On a fresh checkout this is a one-time ~30-60s cost. On a published npm
 * tarball we'll ship `langwatch/node_modules/` pre-installed (via
 * npx-server-publish.yml), so the existsSync short-circuits and this is a
 * no-op — but the safety net stays for `pnpm pack`-driven local dogfood.
 */
export async function ensureLangwatchDeps(ctx: RuntimeContext, bus: EventBus): Promise<void> {
  const langwatchDir = locateLangwatchDir();
  if (!langwatchDir) throw new Error("langwatch app dir not found");

  const nodeModulesPath = join(langwatchDir, "node_modules");
  const distPath = join(langwatchDir, "dist");
  // Fast path: deps installed AND prisma client AND vite-built client all present.
  // Published npm tarballs ship every artifact pre-built so this is a no-op
  // for end users.
  if (
    existsSync(nodeModulesPath) &&
    existsSync(join(nodeModulesPath, ".prisma")) &&
    existsSync(join(distPath, "client"))
  ) {
    return;
  }

  bus.emit({ type: "starting", service: "pnpm:langwatch" as never });
  const start = Date.now();

  // Run install + (optionally) full build in the langwatch dir.
  //
  // We use `pnpm -C <dir>` instead of `cwd: langwatchDir` because pnpm's
  // workspace-aware mode resolves the workspace ROOT package.json when
  // invoked through corepack (or sometimes plain pnpm too) — leading to
  // "Missing script: build. Did you mean pnpm run build:cli?" because
  // build:cli is on root. `-C` is the official "change to package dir
  // and only that dir" flag. Also drop corepack indirection: every CI
  // runner + dev machine that ships `node` either ships `pnpm` on PATH
  // (via pnpm/action-setup) or has corepack-enabled pnpm shimmed onto
  // PATH already, so we can call `pnpm` directly.
  const pnpm = await resolvePnpm();
  const distAlreadyBuilt = existsSync(join(distPath, "client"));

  if (!existsSync(nodeModulesPath)) {
    // When `dist/client/` ships pre-built (published tarball), we never run
    // vite/esbuild/scenario-child-process locally — so we can install with
    // `--prod` and skip ~50 devDependencies (vite, vitest, playwright,
    // esbuild, type generators, etc.). Saves disk + install time on the
    // user's machine. For dev/checkout flows where dist/ is missing, we
    // still need devDeps to run the build below.
    const installArgs = distAlreadyBuilt
      ? ["install", "--prod", "--frozen-lockfile"]
      : ["install", "--prod=false", "--frozen-lockfile"];
    await execa(pnpm.command, [...pnpm.args, "-C", langwatchDir, ...installArgs], {
      stdio: "inherit",
    });

    // pnpm install does NOT auto-generate the prisma client (Prisma's
    // `postinstall` is on `@prisma/client` only when bundled via `prisma`
    // CLI's package.json — we get the CLI as a normal dep, not via the
    // bundled installer). Without this step, `langwatch/node_modules/.prisma/client/`
    // doesn't exist and the langwatch app crashes at boot with
    // `Cannot find module '.prisma/client/index'`. The full-build path
    // below (when !distAlreadyBuilt) covers this via start:prepare:files →
    // prisma:generate:typescript; the prebuilt-dist path needs an explicit
    // call.
    if (distAlreadyBuilt) {
      await execa(pnpm.command, [...pnpm.args, "-C", langwatchDir, "exec", "prisma", "generate"], {
        stdio: "inherit",
      });
    }
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
    await execa(pnpm.command, [...pnpm.args, "-C", langwatchDir, "run", "build"], {
      stdio: "inherit",
      env: {
        ...process.env,
        NODE_ENV: "production",
      },
    });
  }

  bus.emit({ type: "healthy", service: "pnpm:langwatch" as never, durationMs: Date.now() - start });
}

async function resolvePnpm(): Promise<{ command: string; args: string[] }> {
  // Prefer pnpm directly on PATH (pnpm/action-setup puts it there on CI;
  // corepack shims put it there for end users running `npx ...`). Fall back
  // to `corepack pnpm` only if pnpm isn't reachable. We avoid corepack-as-
  // primary because `corepack pnpm -C <dir>` swallows the `-C` flag in some
  // cases — pnpm gets invoked from its own cwd, not the supplied dir, and
  // langwatch's `build` script isn't found.
  const direct = await execa("pnpm", ["--version"], { reject: false });
  if (direct.exitCode === 0) return { command: "pnpm", args: [] };
  const { exitCode } = await execa("corepack", ["--version"], { reject: false });
  if (exitCode === 0) return { command: "corepack", args: ["pnpm"] };
  throw new Error("pnpm not found on PATH and corepack is unavailable");
}

export function locateLangwatchDir(): string | null {
  // Both the workspace dev layout (packages/server/dist/cli.cjs +
  // workspace-root/langwatch/) and the published tarball layout
  // (@langwatch/server/packages/server/dist/cli.cjs + @langwatch/server/langwatch/)
  // resolve to "3 ups + langwatch" from __dirname. We also probe cwd as a
  // last resort for `node dist/cli.cjs` ran from an unexpected directory.
  //
  // We can't just check for package.json — the workspace root in dev (and
  // GitHub Actions' /home/runner/work/langwatch/langwatch checkout root) also
  // has a package.json, and an earlier 4-up candidate happened to land on it,
  // causing `pnpm -C <workspace-root> run build` to fail with
  // "ERR_PNPM_NO_SCRIPT Missing script: build" (the workspace root has
  // build:cli, not build). Match on name="langwatch" in package.json instead.
  const candidates = [
    join(__dirname, "..", "..", "..", "langwatch"),
    join(process.cwd(), "langwatch"),
  ];
  for (const p of candidates) {
    const pkgPath = join(p, "package.json");
    if (!existsSync(pkgPath)) continue;
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { name?: string };
      if (pkg.name === "langwatch") return p;
    } catch {
      // ignore unreadable / non-JSON, try next
    }
  }
  return null;
}

// Re-exported so other services (migrate.ts, langwatch.ts) can resolve the same path.
void mkdirSync;
