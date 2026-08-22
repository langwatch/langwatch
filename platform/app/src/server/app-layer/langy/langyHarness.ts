import { createLogger } from "@langwatch/observability";
import { featureFlagService } from "~/server/featureFlag";

const logger = createLogger("langwatch:langy:harness");

/**
 * The flag that keeps a project's Langy turns on the pi worker harness. ON by
 * default, so pi is what ships; turning it off per project is the rollback
 * lever to opencode. SYSTEM-scoped and internal-store-only, mirroring
 * `release_langy_enabled`: /ops/feature-flags is the one lever.
 */
export const LANGY_PI_HARNESS_FLAG = "release_langy_pi_harness" as const;

/**
 * Which worker harness a turn runs on. Rides `credentials.harness` into the
 * probe, the dispatch and the warm, and joins the Go manager's worker
 * credential signature (where "" and "opencode" collapse, so pre-flag workers
 * never respawn on deploy). A flag flip is therefore a probe MISS: the next
 * message re-warms the worker on the other harness instead of mutating a
 * running one.
 */
export type LangyHarness = "opencode" | "pi";

/**
 * Resolve the harness for one turn (or one warm, the two must agree, or the
 * warm boots a worker the turn cannot reuse). Never throws: harness selection
 * must never keep a turn from starting, so a flag-store failure falls back to
 * the default harness and says so once in the logs.
 */
export async function resolveLangyHarness({
  userId,
  projectId,
  organizationId,
  flags = featureFlagService,
}: {
  userId: string;
  projectId: string;
  organizationId: string;
  flags?: Pick<typeof featureFlagService, "isEnabled">;
}): Promise<LangyHarness> {
  try {
    const pi = await flags.isEnabled(LANGY_PI_HARNESS_FLAG, {
      distinctId: userId,
      projectId,
      organizationId,
    });
    return pi ? "pi" : "opencode";
  } catch (error) {
    // Fall back to the flag's own default (pi): after the cutover that is
    // what almost every project resolves to, so a flag-store blip changes
    // nothing for them instead of churning every worker's credential
    // signature back and forth.
    logger.warn(
      { error, projectId },
      "langy harness flag evaluation failed, running on pi",
    );
    return "pi";
  }
}
