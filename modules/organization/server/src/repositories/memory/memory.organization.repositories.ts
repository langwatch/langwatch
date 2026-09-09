import type { OrganizationRepositories } from "../organization.repositories.ts";
import { MemoryGroupRepository } from "./memory.group.repository.ts";
import { MemoryOrganizationDatabase } from "./memory.organization.database.ts";
import { MemoryOrganizationRepository } from "./memory.organization.repository.ts";
import { MemoryTeamRepository } from "./memory.team.repository.ts";

/** The memory-backed provider: one shared database for organization, team and group. */
export const MemoryOrganizationRepositories = {
  requires: [] as const,
  create: (): OrganizationRepositories => {
    const memory = MemoryOrganizationDatabase.create();
    return {
      organization: MemoryOrganizationRepository.create({ memory }),
      team: MemoryTeamRepository.create({ memory }),
      group: MemoryGroupRepository.create({ memory }),
    };
  },
};
