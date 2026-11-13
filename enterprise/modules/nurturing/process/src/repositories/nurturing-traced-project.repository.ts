// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/** A project nurturing copied as traced from trace's and project's facts. */
export type NurturingTracedProjectRow = Readonly<{ projectId: string; organizationId: string }>;

/** Nurturing's own copy of each project that received a real trace (§9), never project's table. */
export interface NurturingTracedProjectRepository {
  /** Records the project once; a later record of it changes nothing. */
  recordTraced(input: NurturingTracedProjectRow): Promise<void>;
  /** True when any project nurturing recorded for the organization, archived ones included, traced. */
  hasTraced(input: Readonly<{ organizationId: string }>): Promise<boolean>;
}
