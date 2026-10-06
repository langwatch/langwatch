// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type { NurturingClaimRepository } from "./nurturing-claim.repository.ts";
import type { NurturingMilestonesRepository } from "./nurturing-milestones.repository.ts";

/** The rows nurturing owns, chosen once at boot. */
export interface NurturingRepositories {
  readonly milestones: NurturingMilestonesRepository;
  readonly claims: NurturingClaimRepository;
}
