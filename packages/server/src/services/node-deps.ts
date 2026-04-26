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
  if (existsSync(nodeModulesPath) && existsSync(join(nodeModulesPath, ".prisma"))) {
    return;
  }

  bus.emit({ type: "starting", service: "pnpm:langwatch" as never });
  const start = Date.now();

  // Run install + prepare in the langwatch dir. Use corepack-vended pnpm so
  // the user doesn't need a global pnpm install.
  const pnpm = await resolvePnpm();
  await execa(pnpm.command, [...pnpm.args, "install", "--prod=false", "--frozen-lockfile"], {
    cwd: langwatchDir,
    stdio: "inherit",
  });

  // start:prepare:files generates prisma client, zod types, sdk versions,
  // langevals types, and builds the mcp-server. langwatch app boot reads
  // every one of these — without them, pnpm start crashes with module-not-found.
  await execa(pnpm.command, [...pnpm.args, "run", "start:prepare:files"], {
    cwd: langwatchDir,
    stdio: "inherit",
  });

  bus.emit({ type: "healthy", service: "pnpm:langwatch" as never, durationMs: Date.now() - start });
}

async function resolvePnpm(): Promise<{ command: string; args: string[] }> {
  // Prefer corepack pnpm so users don't need a global install. Fall back to
  // the pnpm on PATH if corepack isn't available.
  const { exitCode } = await execa("corepack", ["--version"], { reject: false });
  if (exitCode === 0) return { command: "corepack", args: ["pnpm"] };
  return { command: "pnpm", args: [] };
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
