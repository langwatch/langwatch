/**
 * The re-runnable floor (round 21, S3-RETRY): every Prisma folder named after this one is
 * re-runnable, which the `rerunnable-migrations` enforcer policy refuses to let slip. Never move
 * it back; specs/upgrade/rerunnable-migrations.feature.
 */
export const RERUNNABLE_PRISMA_FROM = "20261006180001_gateway_realtime_session_metering";

/** Whether the upgrade may mark this migration's failed row rolled back and apply it again. */
export function isRerunnablePrismaMigration({ name }: { name: string }): boolean {
  return name > RERUNNABLE_PRISMA_FROM;
}
