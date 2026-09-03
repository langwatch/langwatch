import type { RuntimeContext } from "../shared/runtime-contract.ts";
import type { EventBus } from "./event-bus.ts";
import { locateTasksDir, resolvePnpm } from "./node-deps.ts";
import { execAndPipe } from "./_pipe-to-bus.ts";

/**
 * Run Prisma migrations against the embedded postgres + ClickHouse goose
 * migrations against the embedded clickhouse. Both run through apps/tasks'
 * `@langwatch/task` launcher, which declares the prisma CLI as a runtime
 * dependency, so this is a thin shell-out.
 *
 * Idempotent — Prisma reports "Already in sync" and goose reports "no
 * migrations to run" when the schema is current.
 *
 * envFromFile is the `.env` we scaffold into LANGWATCH_HOME — each task
 * parses the process configuration it needs at boot and refuses by name on a
 * missing leaf, even for a migrate-only invocation. Without this overlay the
 * task exits 1 before goose ever runs.
 */
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
  const start = Date.now();

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
  await execAndPipe(
    bus,
    "migrate:prisma",
    pnpm.command,
    [...pnpm.args, "run", "task", "prisma-migrate"],
    { cwd: tasksDir, env },
  );
  await execAndPipe(
    bus,
    "migrate:clickhouse",
    pnpm.command,
    [...pnpm.args, "run", "task", "clickhouse-migrate"],
    { cwd: tasksDir, env },
  );

  bus.emit({
    type: "healthy",
    service: "postgres",
    durationMs: Date.now() - start,
  });
}
