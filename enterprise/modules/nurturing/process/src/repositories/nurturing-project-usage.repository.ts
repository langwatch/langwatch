// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type { FoldProjectionStore } from "@langwatch/eventing";

import type { NurturingProjectUsageState } from "../rules/nurturing-project-usage.rules.ts";

/**
 * The folds' version. A row of another version is left out of the read and makes its fold throw
 * (no re-fold path), so a bump needs a data migration or a replay first.
 */
export const NURTURING_PROJECT_USAGE_PROJECTION_VERSION = "2026-11-10" as const;

/**
 * The owner pipeline a peer fold reads: one fold per owner, since a peer fold re-folds from one
 * owner's log (§9). Each owner's fold keeps its own row per project.
 */
export type NurturingProjectUsageOwner = "prompt" | "evaluator" | "scenario" | "simulation";

/** The read over the project-usage rows. */
export interface NurturingProjectUsageReadRepository {
  /** Every owner's row of the current version for each of the projects. */
  findForProjects(
    input: Readonly<{ projectIds: readonly string[] }>,
  ): Promise<NurturingProjectUsageState[]>;
}

/**
 * The row of a project's evaluation days. Not a peer fold: evaluations are too many to write one
 * row per evaluation, so a throttled subscriber adds at most one day per project a day.
 */
export const EVALUATION_ACTIVITY_OWNER = "evaluation" as const;

/** Nurturing's own project-usage rows: one fold store per owner, and the read over them all. */
export interface NurturingProjectUsageRepository extends NurturingProjectUsageReadRepository {
  /** The store of one owner's fold; its rows are keyed by project and owner. */
  forOwner(owner: NurturingProjectUsageOwner): FoldProjectionStore<NurturingProjectUsageState>;
  /** Adds the evaluation's UTC day to the project's evaluation row; a known day writes nothing. */
  recordEvaluationDay(input: Readonly<{ projectId: string; occurredAt: number }>): Promise<void>;
}
