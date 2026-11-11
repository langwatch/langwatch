// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type { NurturingTraceDay } from "../rules/nurturing-trace-day.rules.ts";

/** The read and retention of the per-project, per-day trace counts: no write. */
export interface NurturingTraceDayReadRepository {
  /** The projects' days after `afterDay`. */
  findForProjects(
    input: Readonly<{ projectIds: readonly string[]; afterDay: string }>,
  ): Promise<NurturingTraceDay[]>;
  /** Drops the projects' days before `beforeDay`: no read reaches them any more. */
  pruneBefore(input: Readonly<{ projectIds: readonly string[]; beforeDay: string }>): Promise<void>;
}

/** Nurturing's per-project, per-day trace counts: the increment, and the read. */
export interface NurturingTraceDayRepository extends NurturingTraceDayReadRepository {
  /**
   * Adds each increment's counts to its project's day, the newest times kept: one atomic write
   * per day. Not idempotent: a redelivered batch, or a retry after a write, counts again.
   */
  addTraceDays(increments: readonly NurturingTraceDay[]): Promise<void>;
}
