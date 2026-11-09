// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type { NurturingOrganizationState } from "./nurturing-milestones.repository.ts";

/** Which organization a project belongs to, as its owners hold it, or that they hold none. */
export type NurturingProjectPlacement =
  | Readonly<{ outcome: "known"; organizationId: string }>
  | Readonly<{ outcome: "unknown" }>;

/**
 * Project's `Project` and organization's `Team` and `Organization` rows, read through their shares, never a copy
 * (round 46 E1, R40). It claims no table: the owners keep theirs.
 */
export interface NurturingProjectDirectoryRepository {
  /** Unknown is an answer: nurturing counts nothing for a project its owners do not hold. */
  getPlacement(input: Readonly<{ projectId: string }>): Promise<NurturingProjectPlacement>;
  /** The owner of a personal project, as one id; none for a shared or unknown project. */
  findPersonalOwnerUserIds(input: Readonly<{ projectId: string }>): Promise<string[]>;
  /** The organization's earliest project, archived ones included, through its teams. */
  getFirstProjectCreatedAt(
    input: Readonly<{ organizationId: string }>,
  ): Promise<Pick<NurturingOrganizationState, "firstProjectCreatedAt">>;
  /** When the organization was created, in epoch ms; null when its owners hold no such row. */
  getOrganizationCreatedAt(
    input: Readonly<{ organizationId: string }>,
  ): Promise<Readonly<{ organizationCreatedAt: number | null }>>;
  /** True when any project of the organization, archived ones included, received a real trace. */
  hasTracedProject(input: Readonly<{ organizationId: string }>): Promise<boolean>;
}
