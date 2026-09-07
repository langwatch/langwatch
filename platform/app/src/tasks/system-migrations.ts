import { setEnvironment } from "@langwatch/ksuid";

/** Runs every in-place system migration before any serving lane starts. */
export default async function runSystemMigrations(): Promise<void> {
  setEnvironment(process.env.ENVIRONMENT ?? "local");

  const [{ getApp }, { initializeMigrationApp }, { assertRedisReady }, boot] =
    await Promise.all([
      import("~/server/app-layer/app"),
      import("~/server/app-layer/presets"),
      import("~/server/app-layer/redis-readiness"),
      import("~/server/app-layer/system-migrations/boot"),
    ]);

  initializeMigrationApp();
  await assertRedisReady();
  const app = getApp();
  const eventSourcing = app.eventSourcing;
  const queue = eventSourcing?.globalQueue;
  const waitUntilIdle = queue?.waitUntilPreflightIdle;
  if (!waitUntilIdle) {
    throw new Error(
      "Migration preflight queue does not expose a completion barrier",
    );
  }
  await boot.runSystemMigrationsToQuiescence({
    redis: app.redis,
    awaitPassEffects: () => waitUntilIdle.call(queue),
  });
}
