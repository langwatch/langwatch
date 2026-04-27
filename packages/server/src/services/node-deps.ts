import { execa } from "execa";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { RuntimeContext } from "../shared/runtime-contract.ts";
import { appRoot } from "./app-dir.ts";
import type { EventBus } from "./event-bus.ts";
import { execAndPipe } from "./_pipe-to-bus.ts";

/**
 * Ensure langwatch/node_modules exists + start:prepare:files has run, both of
 * which are prerequisites for `pnpm run prisma:migrate` and `pnpm run start:app`.
 *
 * Runs INSIDE the relocated app tree (LANGWATCH_HOME/app/langwatch/) — see
 * services/app-dir.ts for why we relocate out of node_modules.
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
      "pnpm:langwatch",
      pnpm.command,
      [...pnpm.args, "-C", langwatchDir, "install", "--prod=false", "--frozen-lockfile"],
    );

    // pnpm install does NOT auto-generate the prisma client. The full-
    // build path below (when !distAlreadyBuilt) covers this via
    // start:prepare:files → prisma:generate:typescript; the prebuilt-
    // dist path needs an explicit call so .prisma/client/ exists before
    // the langwatch app boots.
    if (distAlreadyBuilt) {
      await execAndPipe(
        bus,
        "pnpm:langwatch",
        pnpm.command,
        [...pnpm.args, "-C", langwatchDir, "exec", "prisma", "generate"],
      );
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
    await execAndPipe(
      bus,
      "pnpm:langwatch",
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
  // appRoot() returns the relocated tree (LANGWATCH_HOME/app) once
  // ensureAppDir has run, or the dev workspace fallback otherwise.
  const dir = join(appRoot(), "langwatch");
  return existsSync(join(dir, "package.json")) ? dir : null;
}
