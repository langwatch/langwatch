// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type { OrganizationApi } from "@langwatch/organization-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";

import { MemoryNurturingMilestonesRepository } from "../../repositories/memory/memory.nurturing-milestones.repository.ts";
import { MemoryNurturingProjectDirectoryRepository } from "../../repositories/memory/memory.nurturing-project-directory.repository.ts";
import { MemoryNurturingClaimRepository } from "../../repositories/memory/memory.nurturing.repositories.ts";
import { NurturingMemberFactsService } from "../nurturing-member-facts.service.ts";

/** No project placed and no organization of anyone: a signal tells only the admin it names. */
export function unplacedMemberFacts(): NurturingMemberFactsService {
  return NurturingMemberFactsService.create({
    claims: MemoryNurturingClaimRepository.create(),
    milestones: MemoryNurturingMilestonesRepository.create(),
    projects: MemoryNurturingProjectDirectoryRepository.create(),
    organizations: createApiFixture<OrganizationApi>({
      organizationIdsForMember: async () => [],
    }),
  });
}
