import { createLogger } from "@langwatch/observability";
import { featureFlagService } from "~/server/featureFlag";

const logger = createLogger("langwatch:langy:delete-gate");

/**
 * The flag that keeps a project's Langy worker registering the pre-execution
 * delete gate (issue #7608). ON by default, so the gate is what ships; turning
 * it off per project is the rollback lever. SYSTEM-scoped and
 * internal-store-only, mirroring `release_langy_pi_harness`: /ops/feature-flags
 * is the one lever.
 */
export const LANGY_DELETE_GATE_FLAG = "release_langy_delete_gate" as const;

/**
 * Resolve whether the delete gate is enabled for one turn (or one warm — the
 * two must agree, or the warm boots a worker the turn cannot reuse). Never
 * throws: gate selection must never keep a turn from starting, so a flag-store
 * failure falls back to ON (the fail-safe direction — a blip keeps the gate,
 * never silently drops it) and says so once in the logs. Mirrors
 * `resolveLangyHarness`.
 */
export async function resolveLangyDeleteGate({
  userId,
  projectId,
  organizationId,
  flags = featureFlagService,
}: {
  userId: string;
  projectId: string;
  organizationId: string;
  flags?: Pick<typeof featureFlagService, "isEnabled">;
}): Promise<boolean> {
  try {
    return await flags.isEnabled(LANGY_DELETE_GATE_FLAG, {
      distinctId: userId,
      projectId,
      organizationId,
    });
  } catch (error) {
    logger.warn(
      { error, projectId },
      "langy delete-gate flag evaluation failed, keeping the gate on",
    );
    return true;
  }
}
