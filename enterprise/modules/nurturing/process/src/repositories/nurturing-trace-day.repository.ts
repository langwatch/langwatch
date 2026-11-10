// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type { FoldProjectionStore } from "@langwatch/eventing";

import type { NurturingTraceDayState } from "../rules/nurturing-trace-day.rules.ts";

/**
 * The trace-day fold's version. A row of another version is left out of every read and makes the
 * fold throw (no re-fold path), so a bump needs a data migration or a replay first.
 */
export const NURTURING_TRACE_DAY_PROJECTION_VERSION = "2026-11-10" as const;

/** The projects already seeded, and their seed days in the window. */
export type NurturingTraceSeeds = Readonly<{
  seededProjectIds: readonly string[];
  days: NurturingTraceDayState[];
}>;

/** The read, retention and seed of the per-project, per-day trace counts: no fold write. */
export interface NurturingTraceDayReadRepository {
  /** The projects' days after `afterDay`, of the current version. */
  findForProjects(
    input: Readonly<{ projectIds: readonly string[]; afterDay: string }>,
  ): Promise<NurturingTraceDayState[]>;
  /** Drops the projects' days before `beforeDay`: no read reaches them any more. */
  pruneBefore(input: Readonly<{ projectIds: readonly string[]; beforeDay: string }>): Promise<void>;
  /** The projects' seeds: which were seeded, and their seed days after `afterDay`. */
  findSeeds(
    input: Readonly<{ projectIds: readonly string[]; afterDay: string }>,
  ): Promise<NurturingTraceSeeds>;
  /**
   * Keeps a project's seed, its days from trace's rollup before the fold's first trace; the row is
   * the durable mark that it was seeded. A project already seeded keeps its first seed.
   */
  recordSeed(
    input: Readonly<{
      projectId: string;
      seededAt: number;
      days: readonly NurturingTraceDayState[];
    }>,
  ): Promise<void>;
}

/** Nurturing's per-project, per-day trace counts: the fold's store, and the read over its rows. */
export interface NurturingTraceDayRepository extends NurturingTraceDayReadRepository {
  /** The fold's store; its rows are keyed by the rules' `traceDayKey`. */
  readonly store: FoldProjectionStore<NurturingTraceDayState>;
}
