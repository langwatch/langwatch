// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/** One project and UTC day with a completed evaluation. */
export type NurturingEvaluationDay = Readonly<{
  projectId: string;
  /** UTC `YYYY-MM-DD`. */
  day: string;
}>;

/** The read and retention of the projects' evaluation days: no write. */
export interface NurturingEvaluationDayReadRepository {
  /** The projects' evaluation days after `afterDay`, each once. */
  findForProjects(
    input: Readonly<{ projectIds: readonly string[]; afterDay: string }>,
  ): Promise<NurturingEvaluationDay[]>;
  /** Drops every day of the projects: past their organization's window nothing reads them. */
  pruneProjects(input: Readonly<{ projectIds: readonly string[] }>): Promise<void>;
}

/**
 * Nurturing's own copy of each project's evaluation days (`NurturingProjectEvaluationDay`), from
 * evaluation's completed facts (§9). Each write is insert-ignore, so a redelivered, late or
 * replayed fact leaves the copy as live delivery would.
 */
export interface NurturingEvaluationDayRepository extends NurturingEvaluationDayReadRepository {
  /** Records the day; a known day writes nothing. */
  recordDay(day: NurturingEvaluationDay): Promise<void>;
  /** Records every day in one write; known days, and repeats in the list, write nothing. */
  recordDays(days: readonly NurturingEvaluationDay[]): Promise<void>;
}
