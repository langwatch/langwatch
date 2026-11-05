// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * How many repo keys an organization's row holds, so its size stays bounded; the count stops here.
 * Far past what nurturing segments on, and a few tens of KB at most.
 */
export const MAX_CODING_REPOSITORY_KEYS = 500;

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

/** The organization's latest trace, the one fact of it a person joining later must be told. */
export interface NurturingTraceMilestonesRepository {
  /** Moves the time forward only; a late trace or an organization never learned changes nothing. */
  recordLastTrace(input: Readonly<{ organizationId: string; occurredAt: number }>): Promise<void>;
  /** Epoch ms of the latest recorded trace; null when none was recorded. */
  findLastTraceAt(input: Readonly<{ organizationId: string }>): Promise<number | null>;
}

/** The coding-agent signals of the same organizations table, written one conditional update each. */
export interface NurturingCodingMilestonesRepository {
  /** The organization's row; empty when nurturing never learned it. */
  findOrganization(
    input: Readonly<{ organizationId: string }>,
  ): Promise<NurturingOrganizationRow[]>;
  /**
   * Sets the first coding session once; `first` is true for the setter and a retry of its
   * `occurredAt`.
   */
  recordCodingFirstSession(
    input: Readonly<{ organizationId: string; occurredAt: number }>,
  ): Promise<{ first: boolean }>;
  /** Adds the agent type once; the list is always the current one. */
  addCodingAgentType(
    input: Readonly<{ organizationId: string; agentType: string }>,
  ): Promise<string[]>;
  /** Adds the terminal type once; the list is always the current one. */
  addCodingTerminalType(
    input: Readonly<{ organizationId: string; terminalType: string }>,
  ): Promise<string[]>;
  /** Adds the repo's key once, up to the cap; answers how many distinct repos it holds. */
  addCodingRepository(
    input: Readonly<{ organizationId: string; repositoryKey: string }>,
  ): Promise<number>;
  /** Adds a first-three-days offset once; answers how many distinct offsets it holds. */
  addCodingSessionDayOffset(
    input: Readonly<{ organizationId: string; dayOffset: number }>,
  ): Promise<number>;
  /** Counts the UTC `day` when later than the last one; `changed` stays true for that same day. */
  recordCodingActiveDay(
    input: Readonly<{ organizationId: string; day: string }>,
  ): Promise<{ changed: boolean; codingActiveDays: number }>;
}
