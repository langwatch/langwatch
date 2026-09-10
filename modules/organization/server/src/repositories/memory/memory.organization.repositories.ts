import type { OrganizationRepositories } from "../organization.repositories.ts";
import { MemoryGroupRepository } from "./memory.group.repository.ts";
import { MemoryOrganizationDatabase } from "./memory.organization.database.ts";
import { MemoryOrganizationMembershipRepository } from "./memory.organization-membership.repository.ts";
import { MemoryOrganizationRepository } from "./memory.organization.repository.ts";
import { MemoryPersonalTeamScopeRepository } from "./memory.personal-team-scope.repository.ts";
import { MemoryTeamRepository } from "./memory.team.repository.ts";
import { MemoryTenantDirectoryRepository } from "./memory.tenant-directory.repository.ts";

/**
 * The memory-backed provider: one shared database for organization, team,
 * group and membership. The grant ledger is ignored here - a memory-backed
 * boot has no AuthZ peer to write through, so membership's own role columns
 * (`OrganizationUser.role`, `TeamUser.role`) are the whole answer.
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
      tenantDirectory: MemoryTenantDirectoryRepository.create({ memory }),
    };
  },
};
