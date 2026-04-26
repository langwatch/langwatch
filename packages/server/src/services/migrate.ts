import { execa } from "execa";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import type { RuntimeContext } from "../shared/runtime-contract.ts";
import type { EventBus } from "./event-bus.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Run Prisma migrations against the embedded postgres + ClickHouse goose
 * migrations against the embedded clickhouse. Both binaries are bundled
 * with the langwatch app already (via langwatch/node_modules and goose in
 * scripts/), so this is a thin shell-out.
 *
 * Idempotent — Prisma reports "Already in sync" and goose reports "no
 * migrations to run" when the schema is current.
 */
export async function runMigrations(ctx: RuntimeContext, bus: EventBus): Promise<void> {
  const langwatchDir = resolveLangwatchDir();
  if (!langwatchDir) {
    throw new Error(
      "could not locate langwatch app directory — expected next to packages/server (monorepo) or under @langwatch/server install root",
    );
  }

  bus.emit({ type: "starting", service: "postgres" }); // re-emitted as a "phase 2" marker
  const start = Date.now();

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    DATABASE_URL: `postgresql://langwatch@127.0.0.1:${ctx.ports.postgres}/langwatch_db?schema=langwatch_db&connection_limit=5`,
    CLICKHOUSE_URL: `http://127.0.0.1:${ctx.ports.clickhouseHttp}/langwatch`,
    SKIP_PRISMA_MIGRATE: "false",
    SKIP_CLICKHOUSE_MIGRATE: "false",
  };

  await execa("pnpm", ["run", "prisma:migrate"], { cwd: langwatchDir, env, stdio: "inherit" });
  await execa("pnpm", ["run", "clickhouse:migrate"], { cwd: langwatchDir, env, stdio: "inherit" });

  bus.emit({ type: "healthy", service: "postgres", durationMs: Date.now() - start });
}

function resolveLangwatchDir(): string | null {
  const candidates = [
    join(__dirname, "..", "..", "..", "..", "langwatch"),
    join(__dirname, "..", "..", "..", "langwatch"),
    join(process.cwd(), "langwatch"),
  ];
  return candidates.find((p) => existsSync(join(p, "package.json"))) ?? null;
}
