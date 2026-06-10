import { backfillLegacyPrivacy } from "~/server/data-privacy/backfill/legacyPrivacyBackfill";
import { prisma } from "~/server/db";
import { createLogger } from "~/utils/logger/server";

const logger = createLogger("langwatch:task:backfill-legacy-privacy");

/**
 * Backfill the legacy privacy controls (organization content mode, project
 * captured-input/output visibility, project PII level) into the unified scoped
 * DataPrivacyPolicy. Idempotent — safe to re-run. Run once after deploying the
 * unified policy; the readers honor the legacy fields until this lands, so there
 * is no gap.
 *
 *   pnpm task backfillLegacyPrivacyPolicy
 */
export default async function backfillLegacyPrivacyPolicy() {
  const result = await backfillLegacyPrivacy({ prisma });
  logger.info(
    result,
    "Backfilled legacy privacy controls into the unified data-privacy policy",
  );
}
