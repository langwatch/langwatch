import { nowInstant } from "@langwatch/time";

import type { RuntimeContext } from "../shared/runtime-contract.ts";
import { execAndPipe } from "./_pipe-to-bus.ts";
import type { EventBus } from "./event-bus.ts";
import { locateTasksDir, resolvePnpm } from "./node-deps.ts";

// Run Prisma and ClickHouse goose migrations through apps/tasks launcher.
export async function runMigrations(
  ctx: RuntimeContext,
  bus: EventBus,
  envFromFile: Record<string, string>,
): Promise<void> {
  const tasksDir = locateTasksDir();
  if (!tasksDir) {
    throw new Error(
      "could not locate the langwatch tasks directory — expected apps/tasks next to apps/server (monorepo) or under @langwatch/server install root",
    );
  }

  bus.emit({ type: "starting", service: "postgres" }); // re-emitted as a "phase 2" marker
  const start = nowInstant().epochMilliseconds;

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    ...envFromFile,
    // Prepend ~/.langwatch/bin so the clickhouse-migrate task (which
    // shells out to `which goose`) finds the predep-installed goose binary.
    // Postgres + redis don't need this — they're spawned by absolute path
    // from the supervisor — but goose is the one tool the langwatch app
    // discovers via PATH.
    PATH: `${ctx.paths.bin}:${process.env.PATH ?? ""}`,
    DATABASE_URL: `postgresql://langwatch@127.0.0.1:${ctx.ports.postgres}/langwatch_db?schema=langwatch_db&connection_limit=5`,
    CLICKHOUSE_URL: `http://127.0.0.1:${ctx.ports.clickhouseHttp}/langwatch`,
    SKIP_PRISMA_MIGRATE: "false",
    SKIP_CLICKHOUSE_MIGRATE: "false",
  };

  // resolvePnpm(paths) prefers the bundled <bin>/pnpm (installed by the
  // pnpm predep), so both the OUTER `pnpm run task prisma-migrate` AND the
  // INNER `pnpm exec prisma migrate deploy` (inside PrismaMigrateTask's spawn)
  // resolve to the same binary — the inner one finds it via PATH, which
  // the env block above already prepends with ctx.paths.bin.
  const pnpm = await resolvePnpm(ctx.paths);
  await execAndPipe({
    bus,
    service: "migrate:prisma",
    bin: pnpm.command,
    args: [...pnpm.args, "run", "task", "prisma-migrate"],
    options: { cwd: tasksDir, env },
  });
  await execAndPipe({
    bus,
    service: "migrate:clickhouse",
    bin: pnpm.command,
    args: [...pnpm.args, "run", "task", "clickhouse-migrate"],
    options: { cwd: tasksDir, env },
  });

  bus.emit({
    type: "healthy",
    service: "postgres",
    durationMs: nowInstant().epochMilliseconds - start,
  });
}
