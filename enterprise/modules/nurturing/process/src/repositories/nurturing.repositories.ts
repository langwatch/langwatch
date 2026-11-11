// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type { NurturingClaimRepository } from "./nurturing-claim.repository.ts";
import type {
  NurturingCodingMilestonesRepository,
  NurturingMilestonesRepository,
  NurturingTraceMilestonesRepository,
} from "./nurturing-milestones.repository.ts";
import type { NurturingOrganizationCreatedRepository } from "./nurturing-organization-created.repository.ts";
import type { NurturingProjectDirectoryRepository } from "./nurturing-project-directory.repository.ts";
import type { NurturingProjectPlacementRepository } from "./nurturing-project-placement.repository.ts";
import type { NurturingProjectUsageRepository } from "./nurturing-project-usage.repository.ts";
import type { NurturingTraceDayRepository } from "./nurturing-trace-day.repository.ts";

/** The rows nurturing owns and the owners' project rows it reads (R40), chosen once at boot. */
export interface NurturingRepositories {
  readonly milestones: NurturingMilestonesRepository &
    NurturingCodingMilestonesRepository &
    NurturingTraceMilestonesRepository;
  readonly projects: NurturingProjectDirectoryRepository;
  /** Nurturing's own copy of each project's organization, from project's created event. */
  readonly placements: NurturingProjectPlacementRepository;
  /** Nurturing's own copy of each organization's creation, from organization's created event. */
  readonly organizationsCreated: NurturingOrganizationCreatedRepository;
  /** Nurturing's own per-project usage: the peer folds' rows. */
  readonly projectUsage: NurturingProjectUsageRepository;
  /** Nurturing's own trace counts per project and day: the trace-day fold's rows. */
  readonly traceDays: NurturingTraceDayRepository;
  readonly claims: NurturingClaimRepository;
}
