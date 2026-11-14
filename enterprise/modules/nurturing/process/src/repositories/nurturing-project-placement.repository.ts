// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type { NurturingProjectPlacement } from "./nurturing-project-directory.repository.ts";

/**
 * Nurturing's own copy of which organization a project belongs to (`NurturingProject`), written
 * from project's `lw.project.created` (§9). The per-email usage reads only this, never project's
 * or organization's tables. A project created before nurturing kept the copy is unknown here: its
 * usage sends nothing. A move keeps the organization (`lw.project.moved` is within one), and an
 * archived project stays listed, so neither event changes a row.
 */
export interface NurturingProjectPlacementRepository {
  /** Idempotent: a redelivered or backfilled creation writes the same row again. */
  recordProject(input: Readonly<{ projectId: string; organizationId: string }>): Promise<void>;
  /** Unknown is an answer: the usage sends nothing for a project nurturing never saw created. */
  getPlacement(input: Readonly<{ projectId: string }>): Promise<NurturingProjectPlacement>;
  /** Every project of the organization nurturing saw created, archived ones included. */
  findProjectIds(input: Readonly<{ organizationId: string }>): Promise<string[]>;
}
