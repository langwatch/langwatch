import type { FeatureFlagApi } from "@langwatch/feature-flag-contract";
import { createLogger } from "@langwatch/observability";
import { LANGY_UI_ACTIONS_FLAG, LangyUiActionSurface } from "../app/langy.members.ts";

const logger = createLogger("langwatch:langy:ui-action-surface");

/**
 * Resolves the live UI-action channel through the deployment's flag store.
 *
 * Never throws: a flag-store blip must not stop the turn, and must not
 * advertise a surface the dispatch route may still answer with a dark 404 —
 * so a failed read holds the channel closed rather than open.
 */
export class FeatureFlagLangyUiActionSurfaceAdapter extends LangyUiActionSurface {
  static create(featureFlags: FeatureFlagApi): FeatureFlagLangyUiActionSurfaceAdapter {
    return new FeatureFlagLangyUiActionSurfaceAdapter(featureFlags);
  }

  private constructor(private readonly featureFlags: FeatureFlagApi) {
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
