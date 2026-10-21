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

/** An organization's row with its coding-agent signals, as the coding step reads it. */
export type NurturingOrganizationRow = NurturingOrganizationCounts &
  Readonly<{
    /** Epoch ms of the organization's first coding-agent session; null until recorded. */
    codingFirstSessionAt: number | null;
    codingAgentTypes: string[];
    codingActiveDays: number;
    /** UTC `YYYY-MM-DD` of the latest counted active day; sorts lexically. */
    codingLastActiveDay: string | null;
  }>;

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
  /** Counts `by` more evaluations for the organization in one step; empty when it is not learned. */
  countEvaluation(
    input: Readonly<{ organizationId: string; by: number }>,
  ): Promise<NurturingOrganizationCounts[]>;
  /** Counts `by` more finished simulation runs in one step; empty when the organization is not learned. */
  countSimulationRun(
    input: Readonly<{ organizationId: string; by: number }>,
  ): Promise<NurturingOrganizationCounts[]>;
}

/** The coding-agent signals of the same organizations table, written one conditional update each. */
export interface NurturingCodingMilestonesRepository {
  /** The organization's row; empty when nurturing never learned it. */
  findOrganization(
    input: Readonly<{ organizationId: string }>,
  ): Promise<NurturingOrganizationRow[]>;
  /** Sets the first coding session once; `first` is true for the setter and a retry of its `occurredAt`. */
  recordCodingFirstSession(
    input: Readonly<{ organizationId: string; occurredAt: number }>,
  ): Promise<{ first: boolean }>;
  /** Adds the agent type once; the list is always the current one, `changed` only for a new type. */
  addCodingAgentType(
    input: Readonly<{ organizationId: string; agentType: string }>,
  ): Promise<{ changed: boolean; codingAgentTypes: string[] }>;
  /** Counts the UTC `day` when later than the last one; `changed` stays true for that same day. */
  recordCodingActiveDay(
    input: Readonly<{ organizationId: string; day: string }>,
  ): Promise<{ changed: boolean; codingActiveDays: number }>;
}
