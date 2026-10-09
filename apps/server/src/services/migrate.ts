import { nowInstant } from "@langwatch/time";

import type { RuntimeContext } from "../shared/runtime-contract.ts";
import { execAndPipe } from "./_pipe-to-bus.ts";
import type { EventBus } from "./event-bus.ts";
import { locateTasksDir, resolvePnpm } from "./node-deps.ts";
import { appOfflineEnv, FORCED_ENV } from "./offline-defaults.ts";

/**
 * The npx server's one upgrade, before any service starts (specs/upgrade/entry-points.feature):
 * `upgrade` alone (Postgres, ClickHouse, LangWatchQL), from apps/tasks, like api start.
 * The app and the workers it starts afterwards never migrate.
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
  const start = nowInstant().epochMilliseconds;

  const env: NodeJS.ProcessEnv = {
    // Defaults first so the user's shell and .env override them.
    ...appOfflineEnv(ctx.paths),
    ...process.env,
    ...envFromFile,
    ...FORCED_ENV,
    // ~/.langwatch/bin first: the upgrade finds the predep-installed goose on
    // PATH (Postgres and Redis are spawned by absolute path).
    PATH: `${ctx.paths.bin}:${process.env.PATH ?? ""}`,
    DATABASE_URL: `postgresql://langwatch@127.0.0.1:${ctx.ports.postgres}/langwatch_db?schema=langwatch_db&connection_limit=5`,
    CLICKHOUSE_URL: `http://127.0.0.1:${ctx.ports.clickhouseHttp}/langwatch`,
    SKIP_PRISMA_MIGRATE: "false",
    SKIP_CLICKHOUSE_MIGRATE: "false",
  };

  // resolvePnpm(paths) prefers the bundled <bin>/pnpm, and the upgrade's own
  // Prisma and goose children find it and goose through the PATH set above.
  const pnpm = await resolvePnpm(ctx.paths);
  await execAndPipe({
    bus,
    service: "migrate:upgrade",
    bin: pnpm.command,
    args: [...pnpm.args, "run", "task", "upgrade"],
    options: { cwd: tasksDir, env },
  });

  bus.emit({
    type: "healthy",
    service: "postgres",
    durationMs: nowInstant().epochMilliseconds - start,
  });
}
