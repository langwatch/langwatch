// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type { FoldProjectionStore } from "@langwatch/eventing";

import type {
  NurturingTraceDay,
  NurturingTraceDaySource,
} from "../rules/nurturing-trace-day.rules.ts";

/**
 * The trace-day folds' version. A row of another version is left out of the read and makes its
 * fold throw (no re-fold path), so a bump needs a replay first. Migration
 * `20261124120005_nurturing_project_trace_day_count` seeds its rows at this value; a bump leaves
 * that migration as it is.
 */
export const NURTURING_TRACE_DAY_PROJECTION_VERSION = "2026-11-23" as const;

/** The read and retention of the per-project, per-day trace counts: no write. */
export interface NurturingTraceDayReadRepository {
  /** The projects' days after `afterDay`, one row per source of a day; a read sums them. */
  findForProjects(
    input: Readonly<{ projectIds: readonly string[]; afterDay: string }>,
  ): Promise<NurturingTraceDay[]>;
  /** Drops the projects' days before `beforeDay`: no read reaches them. */
  pruneBefore(input: Readonly<{ projectIds: readonly string[]; beforeDay: string }>): Promise<void>;
  /**
   * Drops every project's days before `beforeDay`, those of projects that never synced included.
   * It may stop at a bound and leave the rest to the next call.
   */
  pruneEveryProjectBefore(input: Readonly<{ beforeDay: string }>): Promise<void>;
  /** Drops every day of the projects: past their window nothing reads them. */
  pruneProjects(input: Readonly<{ projectIds: readonly string[] }>): Promise<void>;
}

/** Nurturing's per-project, per-day trace counts: one fold store per source, and the read. */
export interface NurturingTraceDayRepository extends NurturingTraceDayReadRepository {
  /** The store of one source's fold; its rows are keyed by project, day and source. */
  forSource(source: NurturingTraceDaySource): FoldProjectionStore<NurturingTraceDay>;
}
