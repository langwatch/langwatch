// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type { NurturingRepositories } from "../nurturing.repositories.ts";
import { MemoryNurturingClaimRepository } from "./memory.nurturing-claim.repository.ts";
import { MemoryNurturingMilestonesRepository } from "./memory.nurturing-milestones.repository.ts";

export class MemoryNurturingRepositories {
  static readonly requires = [] as const;

  static create(): NurturingRepositories {
    return {
      milestones: MemoryNurturingMilestonesRepository.create(),
      claims: MemoryNurturingClaimRepository.create(),
    };
  }
}
