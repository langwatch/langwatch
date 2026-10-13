// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type { NurturingOrganizationState } from "./nurturing-milestones.repository.ts";

/** Which organization a project belongs to, as its owners hold it, or that they hold none. */
export type NurturingProjectPlacement =
  | Readonly<{ outcome: "known"; organizationId: string }>
  | Readonly<{ outcome: "unknown" }>;

/**
 * Project's `Project` and organization's `Team` rows, read through their shares, never a copy
 * (round 46 E1, R40). It claims no table: the owners keep theirs.
 */
export interface NurturingProjectDirectoryRepository {
  /** Unknown is an answer: nurturing counts nothing for a project its owners do not hold. */
  getPlacement(input: Readonly<{ projectId: string }>): Promise<NurturingProjectPlacement>;
  /** The organization's earliest project, archived ones included, through its teams. */
  getFirstProjectCreatedAt(
    input: Readonly<{ organizationId: string }>,
  ): Promise<Pick<NurturingOrganizationState, "firstProjectCreatedAt">>;
}
