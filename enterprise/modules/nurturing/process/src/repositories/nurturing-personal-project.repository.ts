// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/** A personal project's owner as nurturing copied it from organization's and project's facts. */
export type NurturingPersonalProjectRow = Readonly<{
  projectId: string;
  organizationId: string;
  ownerUserId: string;
}>;

/** Nurturing's own copy of each personal project's owner (§9), never project's table. */
export interface NurturingPersonalProjectRepository {
  /** Keeps the first owner recorded for the project; a later record of it changes nothing. */
  recordOwner(input: NurturingPersonalProjectRow): Promise<void>;
  /** The personal project's owner, as one id; none for a project nurturing never recorded. */
  findOwnerUserIds(input: Readonly<{ projectId: string }>): Promise<string[]>;
}
