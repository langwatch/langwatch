import { execa } from "execa";
import { existsSync, mkdirSync } from "node:fs";
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

  // Run install + full build in the langwatch dir.
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
  if (!existsSync(nodeModulesPath)) {
    await execa(pnpm.command, [...pnpm.args, "-C", langwatchDir, "install", "--prod=false", "--frozen-lockfile"], {
      stdio: "inherit",
    });
  }

  // Full prod build: start:prepare:files → build:scenario-child-process → vite build.
  // start:prepare:files generates Prisma client, Zod types, SDK versions,
  // langevals types (from the source committed in langevals/ts-integration/),
  // and the mcp-server bundle. vite build emits dist/client/ for static serving.
  // Without dist/client/, every UI route returns 404 and only /api/* works.
  await execa(pnpm.command, [...pnpm.args, "-C", langwatchDir, "run", "build"], {
    stdio: "inherit",
    env: {
      ...process.env,
      // The build:scenario-child-process step pre-bundles the worker entry.
      NODE_ENV: "production",
    },
  });

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
  const candidates = [
    join(__dirname, "..", "..", "..", "..", "langwatch"),
    join(__dirname, "..", "..", "..", "langwatch"),
    join(process.cwd(), "langwatch"),
  ];
  return candidates.find((p) => existsSync(join(p, "package.json"))) ?? null;
}

// Re-exported so other services (migrate.ts, langwatch.ts) can resolve the same path.
void mkdirSync;
