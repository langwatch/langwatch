import { execa } from "execa";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { RuntimeContext } from "../shared/runtime-contract.ts";
import type { EventBus } from "./event-bus.ts";
import { httpGetCheck, pollUntilHealthy } from "./health.ts";
import { servicePaths } from "./paths.ts";
import { supervise, type SupervisedHandle } from "./spawn.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * The langwatch (Hono) prod server. Launched via `pnpm run start:app` so
 * we get the same prod entry as docker/helm. node_modules is installed on
 * first run if missing — the npm tarball ships source, not deps, to keep
 * the package small.
 */
export async function startLangwatch(
  ctx: RuntimeContext,
  bus: EventBus,
  envFromFile: Record<string, string>,
): Promise<SupervisedHandle> {
  bus.emit({ type: "starting", service: "langwatch" });
  const start = Date.now();

  const langwatchDir = locateLangwatchDir();
  if (!langwatchDir) throw new Error("langwatch app dir not found");
  await ensureNodeModules(langwatchDir, bus);

  const sp = servicePaths(ctx.paths);
  const handle = supervise({
    spec: {
      name: "langwatch",
      command: "pnpm",
      args: ["run", "start:app"],
      cwd: langwatchDir,
      env: {
        ...process.env,
        ...envFromFile,
        NODE_ENV: "production",
        PORT: String(ctx.ports.langwatch),
        START_WORKERS: "true",
        SKIP_PRISMA_MIGRATE: "true",
        SKIP_CLICKHOUSE_MIGRATE: "true",
      },
    },
    paths: sp,
    bus,
  });

  const ready = await pollUntilHealthy({
    check: httpGetCheck(`http://127.0.0.1:${ctx.ports.langwatch}/api/health`),
    timeoutMs: 120_000,
    intervalMs: 1000,
  });
  if (!ready.ok) {
    await handle.stop();
    throw new Error(`langwatch did not become healthy: ${ready.reason}`);
  }
  bus.emit({ type: "healthy", service: "langwatch", durationMs: Date.now() - start });
  return handle;
}

function locateLangwatchDir(): string | null {
  const candidates = [
    join(__dirname, "..", "..", "..", "..", "langwatch"),
    join(__dirname, "..", "..", "..", "langwatch"),
    join(process.cwd(), "langwatch"),
  ];
  return candidates.find((p) => existsSync(join(p, "package.json"))) ?? null;
}

async function ensureNodeModules(langwatchDir: string, bus: EventBus): Promise<void> {
  if (existsSync(join(langwatchDir, "node_modules"))) return;
  bus.emit({ type: "log", service: "langwatch", stream: "stdout", line: "installing node_modules (one-time setup)..." });
  await execa("pnpm", ["install", "--prod=false", "--frozen-lockfile"], {
    cwd: langwatchDir,
    stdio: "inherit",
  });
}
