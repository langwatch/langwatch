// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type { NurturingClaimRepository } from "./nurturing-claim.repository.ts";
import type { NurturingMilestonesRepository } from "./nurturing-milestones.repository.ts";
import type { NurturingProjectDirectoryRepository } from "./nurturing-project-directory.repository.ts";

/** The rows nurturing owns and the owners' project rows it reads (R40), chosen once at boot. */
export interface NurturingRepositories {
  readonly milestones: NurturingMilestonesRepository;
  readonly projects: NurturingProjectDirectoryRepository;
  readonly claims: NurturingClaimRepository;
}
