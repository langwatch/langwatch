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
  await boot.runSystemMigrationsToQuiescence({ redis: getApp().redis });
}
