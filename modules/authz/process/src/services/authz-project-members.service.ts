import type {
  AuthzCountProjectMembersHoldingInput,
  AuthzProjectMembersHolding,
} from "@langwatch/authz-contract";

import type {
  AuthzReadRepository,
  ScopeLineageRepository,
} from "../repositories/authz-read.repository.ts";
import type { AuthzService } from "./authz.service.ts";

/** Members decided per count; an organisation past it gets a floor (ADR-183 §7). */
export const PROJECT_MEMBERS_DECIDED_LIMIT = 500;
/** Members decided at once: each decision is one collect of that member's grants. */
const DECISIONS_AT_ONCE = 10;

/**
 * ADR-183 §7: how many people a project's spans reach, as the braid dialog names them. Each
 * active member of the project's organisation is decided at the project, one collect per member.
 */
export class AuthzProjectMembersService {
  static create(deps: {
    lineage: Pick<ScopeLineageRepository, "findProjectLineage">;
    members: Pick<AuthzReadRepository, "findActiveMemberIds">;
    decisions: Pick<AuthzService, "canBatchPermissionsByIds">;
  }): AuthzProjectMembersService {
    return new AuthzProjectMembersService(deps);
  }

  private constructor(
    private readonly deps: Parameters<typeof AuthzProjectMembersService.create>[0],
  ) {}

  async countProjectMembersHolding({
    projectId,
    permission,
  }: AuthzCountProjectMembersHoldingInput): Promise<AuthzProjectMembersHolding> {
    const lineage = await this.deps.lineage.findProjectLineage({ projectId });
    if (!lineage) return { count: 0, exact: true };
    const { organizationId, teamId } = lineage;
    const memberIds = await this.deps.members.findActiveMemberIds({
      organizationId,
      limit: PROJECT_MEMBERS_DECIDED_LIMIT + 1,
    });
    const decided = memberIds.slice(0, PROJECT_MEMBERS_DECIDED_LIMIT);
    let count = 0;
    for (let start = 0; start < decided.length; start += DECISIONS_AT_ONCE) {
      const holds = await Promise.all(
        decided.slice(start, start + DECISIONS_AT_ONCE).map(async (userId) => {
          const { byPermission } = await this.deps.decisions.canBatchPermissionsByIds({
            principal: { type: "user", id: userId },
            permissions: [permission],
            organizationId,
            teams: [],
            projects: [{ projectId, teamId }],
          });
          return byPermission.get(permission)?.projects.get(projectId) === true;
        }),
      );
      count += holds.filter(Boolean).length;
    }
    return { count, exact: memberIds.length <= PROJECT_MEMBERS_DECIDED_LIMIT };
  }
}
