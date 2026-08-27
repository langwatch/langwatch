import { createLogger } from "@langwatch/observability";
import type { FeatureFlagService } from "@langwatch/feature-flag-contract";

export const LANGY_PI_HARNESS_FLAG = "release_langy_pi_harness" as const;

export type LangyHarness = "opencode" | "pi";

const logger = createLogger("langwatch:langy:harness");

export async function resolveLangyHarness(input: {
  userId: string;
  projectId: string;
  organizationId: string;
  featureFlags: FeatureFlagService;
}): Promise<LangyHarness> {
  try {
    const enabled = await input.featureFlags.isEnabled(LANGY_PI_HARNESS_FLAG, {
      kind: "project",
      userId: input.userId,
      projectId: input.projectId,
      organizationId: input.organizationId,
    });
    return enabled ? "pi" : "opencode";
  } catch (error) {
    logger.warn({ error, projectId: input.projectId }, "langy harness flag evaluation failed");
    return "pi";
  }
}
