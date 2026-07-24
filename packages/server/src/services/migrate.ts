import type { RuntimeContext } from "../shared/runtime-contract.ts";
import type { EventBus } from "./event-bus.ts";
import { locateLangwatchDir, resolvePnpm } from "./node-deps.ts";
import { execAndPipe } from "./_pipe-to-bus.ts";

/**
 * Run Prisma migrations against the embedded postgres + ClickHouse goose
 * migrations against the embedded clickhouse. Both binaries are bundled
 * with the langwatch app already (via langwatch/node_modules and goose in
 * scripts/), so this is a thin shell-out.
 *
 * Idempotent — Prisma reports "Already in sync" and goose reports "no
 * migrations to run" when the schema is current.
 *
 * envFromFile is the `.env` we scaffold into LANGWATCH_HOME — the langwatch
 * app's pnpm scripts go through `@t3-oss/env-core`, which validates the
 * full env schema (BASE_HOST, NEXTAUTH_SECRET, etc.) at module-load time
 * even for migrate-only invocations. Without this overlay, the script
 * exits 1 before goose ever runs.
 */
export async function runMigrations(
  ctx: RuntimeContext,
  bus: EventBus,
  envFromFile: Record<string, string>,
): Promise<void> {
  const langwatchDir = locateLangwatchDir();
  if (!langwatchDir) {
    throw new Error(
      "could not locate langwatch app directory — expected next to packages/server (monorepo) or under @langwatch/server install root",
    );
  }

  bus.emit({ type: "starting", service: "postgres" }); // re-emitted as a "phase 2" marker
  const start = Date.now();

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    ...envFromFile,
    // Prepend ~/.langwatch/bin so the langwatch app's clickhouse:migrate
    // task (which shells out to `which goose`) finds the predep-installed
    // goose binary. Postgres + redis don't need this — they're spawned by
    // absolute path from the supervisor — but goose is the one tool the
    // langwatch app discovers via PATH.
    PATH: `${ctx.paths.bin}:${process.env.PATH ?? ""}`,
    DATABASE_URL: `postgresql://langwatch@127.0.0.1:${ctx.ports.postgres}/langwatch_db?schema=langwatch_db&connection_limit=5`,
    CLICKHOUSE_URL: `http://127.0.0.1:${ctx.ports.clickhouseHttp}/langwatch`,
    SKIP_PRISMA_MIGRATE: "false",
    SKIP_CLICKHOUSE_MIGRATE: "false",
  };

  // resolvePnpm(paths) prefers the bundled <bin>/pnpm (installed by the
  // pnpm predep), so both the OUTER `pnpm run prisma:migrate` AND the
  // INNER `pnpm prisma migrate deploy` (inside the package.json's `sh -c`)
  // resolve to the same binary — the inner one finds it via PATH, which
  // the env block above already prepends with ctx.paths.bin.
  const pnpm = await resolvePnpm(ctx.paths);
  await execAndPipe(bus, "migrate:prisma", pnpm.command, [...pnpm.args, "run", "prisma:migrate"], { cwd: langwatchDir, env });
  await execAndPipe(bus, "migrate:clickhouse", pnpm.command, [...pnpm.args, "run", "clickhouse:migrate"], { cwd: langwatchDir, env });

  bus.emit({ type: "healthy", service: "postgres", durationMs: Date.now() - start });
}

