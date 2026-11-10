// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type { FoldProjectionStore } from "@langwatch/eventing";

import type { NurturingProjectUsageState } from "../rules/nurturing-project-usage.rules.ts";

/** The fold's version; a stored row of another version is re-folded from the owners' logs. */
export const NURTURING_PROJECT_USAGE_PROJECTION_VERSION = "2026-11-08" as const;

/**
 * The owner pipeline a peer fold reads: one fold per owner, since a peer fold re-folds from one
 * owner's log (§9). Each owner's fold keeps its own row per project.
 */
export type NurturingProjectUsageOwner = "prompt" | "evaluator" | "scenario" | "simulation" | "trace";

/** The reads over the project-usage rows, and the organization each project is placed in. */
export interface NurturingProjectUsageReadRepository {
  /** Records which organization the project is in, on every owner's row for it. */
  placeProject(input: Readonly<{ projectId: string; organizationId: string }>): Promise<void>;
  /** Every owner's row for every placed project in the organization; empty when none was placed. */
  findForOrganization(
    input: Readonly<{ organizationId: string }>,
  ): Promise<NurturingProjectUsageState[]>;
}

/** Nurturing's own project-usage rows: one fold store per owner, and the reads over them all. */
export interface NurturingProjectUsageRepository extends NurturingProjectUsageReadRepository {
  /** The store of one owner's fold; its rows are keyed `<owner>:<project id>`. */
  forOwner(owner: NurturingProjectUsageOwner): FoldProjectionStore<NurturingProjectUsageState>;
}

/** The row id of an owner's fold for a project. */
export function projectUsageRowId(owner: NurturingProjectUsageOwner, projectId: string): string {
  return `${owner}:${projectId}`;
}
