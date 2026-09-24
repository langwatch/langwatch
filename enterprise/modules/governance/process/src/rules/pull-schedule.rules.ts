// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

export interface SchedulableSourceRecord {
  status: string;
  pullSchedule: string | null;
  archivedAt: object | null;
}

/** Whether the scheduler configures a pull for this source; the one rule both it and the sync control read. */
export function schedulerWillPull(source: SchedulableSourceRecord): boolean {
  return (
    source.pullSchedule !== null &&
    source.archivedAt === null &&
    (source.status === "active" || source.status === "awaiting_first_event")
  );
}
