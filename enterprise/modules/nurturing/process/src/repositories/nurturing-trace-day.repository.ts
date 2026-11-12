// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type {
  NurturingCountedTrace,
  NurturingTraceDay,
} from "../rules/nurturing-trace-day.rules.ts";

/** The read and retention of the per-project, per-day trace counts: no write. */
export interface NurturingTraceDayReadRepository {
  /** The projects' days after `afterDay`. */
  findForProjects(
    input: Readonly<{ projectIds: readonly string[]; afterDay: string }>,
  ): Promise<NurturingTraceDay[]>;
  /** Drops the projects' days before `beforeDay`: no read reaches them. */
  pruneBefore(input: Readonly<{ projectIds: readonly string[]; beforeDay: string }>): Promise<void>;
  /** Drops every day of the projects: past their window nothing reads them. */
  pruneProjects(input: Readonly<{ projectIds: readonly string[] }>): Promise<void>;
}

/** Nurturing's per-project, per-day trace counts: the increment, and the read. */
export interface NurturingTraceDayRepository extends NurturingTraceDayReadRepository {
  /**
   * Adds the batch's traces to their project's days, durably, in one atomic write. A redelivered
   * batch counts again: accepted (owner decision, issue 9378).
   */
  countTraces(traces: readonly NurturingCountedTrace[]): Promise<void>;
}
