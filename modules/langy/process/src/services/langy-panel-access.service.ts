import type { AuthzApi } from "@langwatch/authz-contract";
import type { FeatureFlagApi } from "@langwatch/feature-flag-contract";
import {
  LangyNotEnabledError,
  type LangyCredentialSession,
  type LangyPanelCaller,
} from "@langwatch/langy-contract";
import type { ProjectApi } from "@langwatch/project-contract";

import { LangyAccessService } from "./langy-access.service.ts";

/**
 * The gate every panel procedure runs before its own work: never the demo project, then the
 * Langy rollout at the project's organization. Both refuse as not enabled, so neither probes.
 * Spec: modules/langy/specs/langy-panel-trpc.feature
 */
export class LangyPanelAccessService {
  static create(members: {
    featureFlags: FeatureFlagApi;
    projects: Pick<ProjectApi, "getOrganizationId">;
    authz: Pick<AuthzApi, "isDemoProject">;
  }): LangyPanelAccessService {
    return new LangyPanelAccessService(
      LangyAccessService.create({ featureFlags: members.featureFlags }),
      members.projects,
      members.authz,
    );
  }

  private constructor(
    private readonly access: LangyAccessService,
    private readonly projects: Pick<ProjectApi, "getOrganizationId">,
    private readonly authz: Pick<AuthzApi, "isDemoProject">,
  ) {}

  async assertPanelAccess(input: { caller: LangyPanelCaller; projectId: string }): Promise<void> {
    if (this.authz.isDemoProject({ projectId: input.projectId })) {
      throw new LangyNotEnabledError();
    }
    const organizationId = await this.projects.getOrganizationId(input.projectId);
    const allowed = await this.access.hasAccess({
      user: { id: input.caller.userId, email: input.caller.email },
      projectId: input.projectId,
      organizationId,
    });
    if (!allowed) throw new LangyNotEnabledError();
  }

  /** The session a turn's worker credentials are minted for: the person the browser proved. */
  static sessionOf(caller: LangyPanelCaller): LangyCredentialSession {
    return { user: { id: caller.userId, name: caller.name, email: caller.email } };
  }
}
