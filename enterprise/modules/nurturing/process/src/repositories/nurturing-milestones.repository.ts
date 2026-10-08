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

/**
 * Nurturing's own read model, written by its peer subscribers (§9). A project's organization is
 * read through project's and organization's shares, never a copy (round 46 E1, R40).
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
  /** Counts one more evaluation for the project's organization; empty when it is not learned. */
  countEvaluation(input: Readonly<{ projectId: string }>): Promise<NurturingOrganizationState[]>;
  /** Counts one more finished simulation run; empty when the organization is not learned. */
  countSimulationRun(input: Readonly<{ projectId: string }>): Promise<NurturingOrganizationState[]>;
}
