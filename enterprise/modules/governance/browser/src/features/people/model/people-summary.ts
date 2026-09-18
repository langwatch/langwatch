// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * The four figures the People page resumes itself with, counted off the same
 * rows the table draws.
 *
 * Nothing here reads anything. The page has already merged the spend ranking
 * and the people the connected providers named into one list, and the strip
 * above the tabs is a count of that list — not a second, differently-shaped
 * question asked of the server. A summary that queried separately could
 * disagree with the table under it, and a reader has no way to tell which of
 * the two is wrong.
 *
 * `null` is "we did not measure this", which the strip draws as an em dash.
 * Zero is a measurement and means the organization genuinely has none, so a
 * read that has not answered must never collapse into one.
 *
 * Spec: specs/ai-governance/dashboard/people-tabs.feature
 */

import type { PeopleRow } from "./people-rows.ts";

export interface PeopleSummary {
  /** Everyone on the table, before any department filter narrows it. */
  people: number | null;
  /** The organization's own departments. */
  departments: number | null;
  /** People no LangWatch account has been tied to. */
  unmatched: number | null;
  /** People whose spend rolls up under Unassigned. */
  unassigned: number | null;
}

export function summarizePeople({
  rows,
  departmentCount,
  peopleMeasured,
  departmentsMeasured,
}: {
  /** Every row the table holds, unfiltered. */
  rows: readonly PeopleRow[];
  departmentCount: number;
  /** Whether both reads behind the population have actually answered. */
  peopleMeasured: boolean;
  /** Whether the department list has answered. */
  departmentsMeasured: boolean;
}): PeopleSummary {
  return {
    people: peopleMeasured ? rows.length : null,
    unmatched: peopleMeasured
      ? rows.filter((row) => row.status === "unmatched").length
      : null,
    unassigned: peopleMeasured
      ? rows.filter((row) => row.department === null).length
      : null,
    departments: departmentsMeasured ? departmentCount : null,
  };
}
