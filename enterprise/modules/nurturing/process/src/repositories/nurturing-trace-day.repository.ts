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
  /**
   * Drops the projects' days before `beforeDay`, and every project's counted traces before it:
   * no read reaches them, and no trace that old is re-stored or redelivered.
   */
  pruneBefore(input: Readonly<{ projectIds: readonly string[]; beforeDay: string }>): Promise<void>;
}

/** Nurturing's per-project, per-day trace counts: the increment, and the read. */
export interface NurturingTraceDayRepository extends NurturingTraceDayReadRepository {
  /**
   * Counts each trace once per project, id and kind, durably: one atomic write per batch records
   * the traces not yet counted and adds only those to their project's day. A re-stored trace, a
   * redelivered batch or a retry after the write counts nothing again.
   */
  countTraces(traces: readonly NurturingCountedTrace[]): Promise<void>;
}
