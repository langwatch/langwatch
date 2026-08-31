import { createLogger } from "@langwatch/observability";
import type { FeatureFlagService } from "@langwatch/feature-flag-contract";

export const LANGY_UI_ACTIONS_FLAG = "release_langy_ui_actions" as const;

const logger = createLogger("langwatch:langy:ui-action-surface");

/**
 * Whether the live UI-action channel is open for this turn.
 *
 * The same flag `routes/langy-ui-actions.ts` reads before answering: with it
 * off, that route is a dark 404, so the turn block must not advertise
 * `langwatch ui actions` either. Both ends read one flag with the same scope so
 * they cannot disagree.
 *
 * Fails open, matching the flag's own default: a flag store that cannot be
 * reached must not silently retire a shipped channel, and an advertised
 * command that turns out to be dark costs the agent one refused call.
 */
export async function resolveLangyUiActionSurfaceOpen(input: {
  userId: string;
  projectId: string;
  organizationId: string;
  featureFlags: FeatureFlagService;
}): Promise<boolean> {
  try {
    return await input.featureFlags.isEnabled(LANGY_UI_ACTIONS_FLAG, {
      kind: "project",
      userId: input.userId,
      projectId: input.projectId,
      organizationId: input.organizationId,
    });
  } catch (error) {
    logger.warn(
      { error, projectId: input.projectId },
      "langy ui-action surface flag evaluation failed",
    );
    return true;
  }
}
