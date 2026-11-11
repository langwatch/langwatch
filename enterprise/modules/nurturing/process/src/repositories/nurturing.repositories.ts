// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type { NurturingClaimRepository } from "./nurturing-claim.repository.ts";
import type {
  NurturingCodingMilestonesRepository,
  NurturingMilestonesRepository,
  NurturingOrganizationAdminRepository,
  NurturingTraceMilestonesRepository,
} from "./nurturing-milestones.repository.ts";
import type { NurturingPersonalProjectRepository } from "./nurturing-personal-project.repository.ts";
import type { NurturingProjectDirectoryRepository } from "./nurturing-project-directory.repository.ts";
import type { NurturingTracedProjectRepository } from "./nurturing-traced-project.repository.ts";

/** The rows nurturing owns and the owners' project rows it reads (R40), chosen once at boot. */
export interface NurturingRepositories {
  readonly milestones: NurturingMilestonesRepository &
    NurturingCodingMilestonesRepository &
    NurturingTraceMilestonesRepository &
    NurturingOrganizationAdminRepository;
  readonly projects: NurturingProjectDirectoryRepository;
  /** Nurturing's own copies, written from the owners' facts (§9); read by nothing yet. */
  readonly personalProjects: NurturingPersonalProjectRepository;
  readonly tracedProjects: NurturingTracedProjectRepository;
  readonly claims: NurturingClaimRepository;
}
