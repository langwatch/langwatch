import type { FeatureFlagApi } from "@langwatch/feature-flag-contract";
import { createLogger } from "@langwatch/observability";

import { LANGY_UI_ACTIONS_FLAG, LangyUiActionSurface } from "../app/langy.members.ts";

const logger = createLogger("langwatch:langy:ui-action-surface");

/**
 * Resolves the live UI-action channel through the deployment's flag store.
 * Never throws: a flag-store blip must not stop the turn, nor advertise a
 * surface dispatch may 404 - a failed read holds the channel closed.
 */
export class LangyUiActionSurfaceService extends LangyUiActionSurface {
  static create(featureFlags: FeatureFlagApi): LangyUiActionSurfaceService {
    return new LangyUiActionSurfaceService(featureFlags);
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
