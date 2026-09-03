import type { FeatureFlagService } from "@langwatch/feature-flag-contract";
import { createLogger } from "@langwatch/observability";
import { LANGY_UI_ACTIONS_FLAG, LangyUiActionSurfacePort } from "../ports/langy-turn-runtime.port";

const logger = createLogger("langwatch:langy:ui-action-surface");

/**
 * Resolves the live UI-action channel through the deployment's flag store.
 *
 * Never throws: a flag-store blip must not stop the turn, and must not
 * advertise a surface the dispatch route may still answer with a dark 404 —
 * so a failed read holds the channel closed rather than open.
 */
export class FeatureFlagLangyUiActionSurfaceAdapter extends LangyUiActionSurfacePort {
  static create(featureFlags: FeatureFlagService): FeatureFlagLangyUiActionSurfaceAdapter {
    return new FeatureFlagLangyUiActionSurfaceAdapter(featureFlags);
  }

  private constructor(private readonly featureFlags: FeatureFlagService) {
    super();
  }

  async resolve(input: {
    userId: string;
    projectId: string;
    organizationId: string;
  }): Promise<boolean> {
    try {
      return await this.featureFlags.isEnabled(LANGY_UI_ACTIONS_FLAG, {
        kind: "project",
        userId: input.userId,
        projectId: input.projectId,
        organizationId: input.organizationId,
      });
    } catch (error) {
      logger.warn(
        { error, projectId: input.projectId },
        "langy ui-actions flag evaluation failed, holding the channel closed",
      );
      return false;
    }
  }
}
