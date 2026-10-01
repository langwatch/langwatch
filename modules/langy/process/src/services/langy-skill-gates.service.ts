import type { FeatureFlagApi } from "@langwatch/feature-flag-contract";
import {
  disabledLangySkillIds,
  langySkillGateFlags,
  type LangySkillGateFlag,
} from "@langwatch/langy-contract";
import { createLogger } from "@langwatch/observability";

import { LangySkillGates } from "../app/langy.members.ts";

const logger = createLogger("langwatch:langy:skill-gates");

/**
 * Resolves `LANGY_SKILL_GATES` through the deployment's flag store, once per
 * flag. A flag-store error reads as off: the experimental skill stays
 * withheld and the stable skill it excludes stays available.
 */
export class LangySkillGatesService extends LangySkillGates {
  static create(featureFlags: FeatureFlagApi): LangySkillGatesService {
    return new LangySkillGatesService(featureFlags);
  }

  private constructor(private readonly featureFlags: FeatureFlagApi) {
    super();
  }

  async resolveDisabled(input: {
    userId: string;
    projectId: string;
    organizationId: string;
  }): Promise<string[]> {
    const flags = langySkillGateFlags();
    if (flags.length === 0) return [];

    const enabled = new Set<LangySkillGateFlag>();
    await Promise.all(
      flags.map(async (flag) => {
        try {
          const on = await this.featureFlags.isEnabled(flag, {
            kind: "project",
            userId: input.userId,
            projectId: input.projectId,
            organizationId: input.organizationId,
          });
          if (on) enabled.add(flag);
        } catch (error) {
          logger.warn(
            { error, projectId: input.projectId, flag },
            "langy skill flag evaluation failed, treating the skill as gated off",
          );
        }
      }),
    );

    return disabledLangySkillIds((flag) => enabled.has(flag));
  }
}
