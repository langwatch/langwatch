// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/** An organization as nurturing knows it from project's created events and its own counts. */
export type NurturingOrganizationState = Readonly<{
  organizationId: string;
  adminUserId: string | null;
  /** As stored: learned from project's backfill. The rules widen it at read. */
  seeded: boolean;
  evaluationCount: number;
  simulationRunCount: number;
  /** Epoch ms of the organization's earliest project, as project's table holds it. */
  firstProjectCreatedAt: number | null;
}>;

/** An organization as nurturing's own table holds it, without the owners' project facts. */
export type NurturingOrganizationCounts = Omit<NurturingOrganizationState, "firstProjectCreatedAt">;

/**
 * Nurturing's own read model, written by its peer subscribers (§9). A project's organization is
 * read by the service through `NurturingProjectDirectoryRepository`, never here (R40).
 */
export interface NurturingMilestonesRepository {
  /** Learns the project's organization; idempotent, `seeded` is set only when first learned. */
  recordOrganization(
    input: Readonly<{
      organizationId: string;
      adminUserId: string | null;
      seeded: boolean;
    }>,
  ): Promise<void>;
  /** Counts one more evaluation for the organization; empty when it is not learned. */
  countEvaluation(
    input: Readonly<{ organizationId: string }>,
  ): Promise<NurturingOrganizationCounts[]>;
  /** Counts one more finished simulation run; empty when the organization is not learned. */
  countSimulationRun(
    input: Readonly<{ organizationId: string }>,
  ): Promise<NurturingOrganizationCounts[]>;
}
