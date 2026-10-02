// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/** An organization as nurturing knows it from project's created events and its own counts. */
export type NurturingOrganizationState = Readonly<{
  organizationId: string;
  adminUserId: string | null;
  /** Learned from project's backfill: its first_* milestones already happened. */
  seeded: boolean;
  evaluationCount: number;
  simulationRunCount: number;
}>;

/** Nurturing's own read model, written by its peer subscribers (§9). */
export interface NurturingMilestonesRepository {
  /** Idempotent: `seeded` is set only when the organization is first learned. */
  recordProject(
    input: Readonly<{
      projectId: string;
      organizationId: string;
      adminUserId: string | null;
      seeded: boolean;
    }>,
  ): Promise<void>;
  /** Counts one more evaluation for the project's organization; empty when the project is unknown. */
  countEvaluation(input: Readonly<{ projectId: string }>): Promise<NurturingOrganizationState[]>;
  /** Counts one more finished simulation run; empty when the project is unknown. */
  countSimulationRun(input: Readonly<{ projectId: string }>): Promise<NurturingOrganizationState[]>;
}
