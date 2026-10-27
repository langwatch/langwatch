// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type { PersonalContext } from "@langwatch/enterprise-gateway-contract";
import {
  type OrganizationApi,
  PersonalWorkspacePendingError,
} from "@langwatch/organization-contract";
import { type UserApi, UserNotOrganizationMemberError } from "@langwatch/user-contract";

import type { RoutingPolicyService } from "./routing-policy.service.ts";

type Members = Pick<OrganizationApi, "isMember" | "ensurePersonalWorkspace">;
type Policies = Pick<RoutingPolicyService, "findDefaults">;

/**
 * The /me personal context. The workspace is provisioned lazily on first read,
 * so somebody who joined before the feature shipped gets one without
 * re-accepting an invite; a caller outside the organization is refused.
 */
export class PersonalContextService {
  private constructor(
    private readonly members: Members,
    private readonly users: Pick<UserApi, "findById">,
    private readonly policies: Policies,
  ) {}

  static create(options: {
    members: Members;
    users: Pick<UserApi, "findById">;
    policies: Policies;
  }): PersonalContextService {
    return new PersonalContextService(options.members, options.users, options.policies);
  }

  async get({
    userId,
    organizationId,
  }: {
    userId: string;
    organizationId: string;
  }): Promise<PersonalContext> {
    const member = await this.members.isMember({ userId, organizationId });
    if (!member) throw new UserNotOrganizationMemberError(organizationId);

    const profile = await this.users.findById({ id: userId });
    const ensured = await this.members.ensurePersonalWorkspace({
      userId,
      organizationId,
      displayName: profile?.name ?? null,
      displayEmail: profile?.email ?? null,
    });
    if (ensured.kind === "pending") throw new PersonalWorkspacePendingError();
    const { workspace } = ensured;
    const [policy] = await this.policies.findDefaults({
      organizationId,
      personalTeamId: workspace.team.id,
    });

    return {
      // `created` is main's wire field; a call that creates the project now answers pending.
      workspace: { ...workspace, project: { ...workspace.project, apiKey: "" }, created: false },
      routingPolicy: policy ? { id: policy.id, name: policy.name } : null,
    };
  }
}
