// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * Whether the scheduler will pull a source at all.
 *
 * Pure, and a leaf on purpose. This lived inline in
 * `syncIngestionPullSource`, which is where it is USED to decide whether to
 * configure a schedule — but it is also the answer to "is asking this source
 * anything worth a pipeline lease", and that question is asked from the
 * on-demand path, which must not import prisma to get an answer to it.
 *
 * ONE COPY. The scheduled path and the on-demand path disagreeing about which
 * sources are live is not a visible bug — both sides look reasonable in
 * isolation — it is a press that reports asking four sources when the
 * scheduler holds two of them switched off, and a reader waiting on answers
 * that were never going to come.
 *
 * `awaiting_first_event` counts as live. It is a source that has been set up
 * correctly and has not yet been reached by anything, which is precisely a
 * source worth pulling; excluding it would mean a new connection could never
 * make its first pull.
 */

/** The columns of an `IngestionSource` this decision reads. */
export interface SchedulableSourceRecord {
  status: string;
  pullSchedule: string | null;
  archivedAt: Date | null;
}

export function schedulerWillPull(source: SchedulableSourceRecord): boolean {
  return (
    source.pullSchedule !== null &&
    source.archivedAt === null &&
    (source.status === "active" || source.status === "awaiting_first_event")
  );
}
