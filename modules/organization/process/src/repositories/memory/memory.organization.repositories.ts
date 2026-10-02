import type { OrganizationRepositories } from "../organization.repositories.ts";
import { MemoryGroupRepository } from "./memory.group.repository.ts";
import { MemoryOrganizationInviteRateLimitRepository } from "./memory.organization-invite-rate-limit.repository.ts";
import { MemoryOrganizationMembershipRepository } from "./memory.organization-membership.repository.ts";
import { MemoryOrganizationDatabase } from "./memory.organization.database.ts";
import { MemoryOrganizationRepository } from "./memory.organization.repository.ts";
import { MemoryPersonalTeamScopeRepository } from "./memory.personal-team-scope.repository.ts";
import { MemoryScopeGraphRepository } from "./memory.scope-graph.repository.ts";
import { MemoryTeamRepository } from "./memory.team.repository.ts";

/**
 * The memory-backed provider: one shared database for organization, team,
 * group and membership. The grant ledger is ignored — no AuthZ peer to write
 * through — so `OrganizationUser.role`/`TeamUser.role` are the whole answer.
 */
export const MemoryOrganizationRepositories = {
  requires: [] as const,
  create: (): OrganizationRepositories => {
    const memory = MemoryOrganizationDatabase.create();
    return {
      organization: MemoryOrganizationRepository.create({ memory }),
      team: MemoryTeamRepository.create({ memory }),
      group: MemoryGroupRepository.create({ memory }),
      membership: () => MemoryOrganizationMembershipRepository.create({ memory }),
      personalTeamScope: MemoryPersonalTeamScopeRepository.create({ memory }),
      scopeGraph: MemoryScopeGraphRepository.create({ memory }),
      inviteRateLimit: MemoryOrganizationInviteRateLimitRepository.create(),
    };
  },
};
