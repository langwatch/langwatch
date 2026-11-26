// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type { NurturingClaimRepository } from "./nurturing-claim.repository.ts";
import type { NurturingErasedUserRepository } from "./nurturing-erased-user.repository.ts";
import type { NurturingEvaluationDayRepository } from "./nurturing-evaluation-day.repository.ts";
import type { NurturingVirtualKeyRepository } from "./nurturing-gateway-key.repository.ts";
import type {
  NurturingCodingMilestonesRepository,
  NurturingMilestonesRepository,
  NurturingOrganizationAdminRepository,
  NurturingTraceMilestonesRepository,
} from "./nurturing-milestones.repository.ts";
import type { NurturingOrganizationCreatedRepository } from "./nurturing-organization-created.repository.ts";
import type { NurturingOrganizationMemberRepository } from "./nurturing-organization-member.repository.ts";
import type { NurturingOrganizationPlanRepository } from "./nurturing-organization-plan.repository.ts";
import type { NurturingPersonalProjectRepository } from "./nurturing-personal-project.repository.ts";
import type { NurturingProjectDirectoryRepository } from "./nurturing-project-directory.repository.ts";
import type { NurturingProjectPlacementRepository } from "./nurturing-project-placement.repository.ts";
import type { NurturingProjectUsageRepository } from "./nurturing-project-usage.repository.ts";
import type { NurturingTraceDayRepository } from "./nurturing-trace-day.repository.ts";
import type { NurturingTracedProjectRepository } from "./nurturing-traced-project.repository.ts";

/** The rows nurturing owns and the owners' project rows it reads (R40), chosen once at boot. */
export interface NurturingRepositories {
  readonly milestones: NurturingMilestonesRepository &
    NurturingCodingMilestonesRepository &
    NurturingTraceMilestonesRepository &
    NurturingOrganizationAdminRepository;
  readonly projects: NurturingProjectDirectoryRepository;
  /** Nurturing's erasure marks, read by the member, organization and key copies and every send. */
  readonly erasedUsers: NurturingErasedUserRepository;
  /** Nurturing's own copy of each project's organization, from project's created event. */
  readonly placements: NurturingProjectPlacementRepository;
  /** Nurturing's own copy of each organization's creation, from organization's created event. */
  readonly organizationsCreated: NurturingOrganizationCreatedRepository;
  /** Nurturing's own copy of each organization's members, from the owners' member facts. */
  readonly members: NurturingOrganizationMemberRepository;
  /** Nurturing's own copy of each organization's plan, folded from billing's subscription facts. */
  readonly plans: NurturingOrganizationPlanRepository;
  /** Nurturing's own copy of each gateway key, folded from gateway's lifecycle facts. */
  readonly virtualKeys: NurturingVirtualKeyRepository;
  /** Nurturing's own per-project usage: the peer folds' rows. */
  readonly projectUsage: NurturingProjectUsageRepository;
  /** Nurturing's own trace counts per project, day and source: the trace-day folds' rows. */
  readonly traceDays: NurturingTraceDayRepository;
  /** Nurturing's own evaluation days per project, from evaluation's completed facts. */
  readonly evaluationDays: NurturingEvaluationDayRepository;
  /** Nurturing's own copies, written from the owners' facts (§9); read by nothing yet. */
  readonly personalProjects: NurturingPersonalProjectRepository;
  readonly tracedProjects: NurturingTracedProjectRepository;
  readonly claims: NurturingClaimRepository;
}
