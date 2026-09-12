// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * The people and departments a governance admin sees on a People page that has
 * nobody on it yet.
 *
 * Invented, and marked as such by the banner the page renders above them. They
 * exist because an empty table teaches nothing: an admin who has just connected
 * their first source cannot tell whether the screen is waiting for a pull, is
 * broken, or simply has a shape they have not seen. These rows show the shape.
 *
 * Every state the real table can be in is represented, because that is the
 * point: a spender the gateway metered, a person a provider named that nothing
 * has metered, a machine login, and somebody who has been erased. The figures
 * are round enough to read as illustrations rather than as measurements.
 *
 * The people belong to `acme.test`, the invented organization the Costs page's
 * sample spenders already come from. One section, one fiction: a reader moving
 * between the two screens should not have to work out whether they are being
 * shown two different make-believe companies.
 *
 * Spec: specs/ai-governance/dashboard/people-tabs.feature
 */

import { nowInstant, Temporal } from "@langwatch/time";

import type { PeopleRow } from "./people-rows.ts";

const daysAgo = (days: number, nowMs: number): string =>
  Temporal.Instant.fromEpochMilliseconds(nowMs - days * 86_400_000).toString();

/** Sample departments, for a Departments tab with none of its own. */
export const SAMPLE_DEPARTMENTS = [
  "Engineering",
  "Customer Support",
  "Finance",
  "Sales",
] as const;

/**
 * A sample person, written down without the one thing we cannot write down.
 *
 * Every other column is a fixed invention, but "last active" has to read as a
 * time relative to whenever somebody opens the page, so the list below records
 * how many days ago instead of a date. `null` is the person nothing has ever
 * metered, who has no last activity at all.
 */
type SamplePerson = Omit<PeopleRow, "lastActiveIso"> & {
  lastActiveDaysAgo: number | null;
};

/**
 * The sample people themselves, kept out of the function that hands them over.
 *
 * They are a list of invented facts and nothing else, so there is no reason for
 * them to be rebuilt on every call, and every reason for a reader looking for
 * "what does the sample table show" to find one flat list rather than a
 * function body to read through.
 */
const SAMPLE_PEOPLE: readonly SamplePerson[] = [
  {
    key: "sample:1",
    displayName: "avery.nakamura",
    identifier: "avery.nakamura@acme.test",
    provider: null,
    status: "matched",
    matchDetail: "Avery Nakamura",
    evidenceKind: null,
    department: "Engineering",
    spendUsd: 412.4,
    requests: 8_120,
    lastActiveDaysAgo: 0,
    mostUsedTarget: "claude-opus-5",
    actor: null,
    linkedUserId: null,
    isMachine: false,
    needsReview: false,
    suspendedReason: null,
  },
  {
    key: "sample:2",
    displayName: "Priya Raman",
    identifier: "priya.raman@acme.test",
    provider: "copilot_studio_dataverse",
    status: "matched",
    matchDetail: "Priya Raman",
    evidenceKind: "verified_email",
    department: "Customer Support",
    spendUsd: 188.05,
    requests: 3_460,
    lastActiveDaysAgo: 1,
    mostUsedTarget: "gpt-5-mini",
    actor: null,
    linkedUserId: null,
    isMachine: false,
    needsReview: false,
    suspendedReason: null,
  },
  {
    key: "sample:3",
    displayName: "Tomas Berg",
    identifier: "tomas.berg@acme.test",
    provider: "openai_admin",
    status: "unmatched",
    matchDetail: null,
    evidenceKind: null,
    department: "Finance",
    spendUsd: 64.9,
    requests: 910,
    lastActiveDaysAgo: 4,
    mostUsedTarget: "gpt-5-mini",
    actor: null,
    linkedUserId: null,
    isMachine: false,
    needsReview: false,
    suspendedReason: null,
  },
  {
    key: "sample:4",
    displayName: "Lena Okafor",
    identifier: "lena.okafor@acme.test",
    provider: "anthropic_admin",
    status: "unmatched",
    matchDetail: null,
    evidenceKind: null,
    department: "Sales",
    // Named by a provider, metered by nothing: the row the merged table
    // exists for, and the one an admin most needs to recognise.
    spendUsd: null,
    requests: null,
    lastActiveDaysAgo: null,
    mostUsedTarget: null,
    actor: null,
    linkedUserId: null,
    isMachine: false,
    needsReview: false,
    suspendedReason: null,
  },
  {
    key: "sample:5",
    displayName: "nightly-report-runner",
    identifier: "8f2c1b6e-4a19-4d0c-9f7a-2b5e0d3c8a41",
    provider: "databricks_genie",
    status: "unmatched",
    matchDetail: null,
    evidenceKind: null,
    department: null,
    spendUsd: 27.15,
    requests: 240,
    lastActiveDaysAgo: 2,
    mostUsedTarget: "databricks-llama-4",
    actor: null,
    linkedUserId: null,
    isMachine: true,
    needsReview: false,
    suspendedReason: null,
  },
  {
    key: "sample:6",
    displayName: "person_7f31c2",
    identifier: null,
    provider: null,
    status: "erased",
    matchDetail: null,
    evidenceKind: null,
    department: null,
    spendUsd: 9.8,
    requests: 130,
    lastActiveDaysAgo: 21,
    mostUsedTarget: null,
    actor: null,
    linkedUserId: null,
    isMachine: false,
    needsReview: false,
    suspendedReason: null,
  },
];

/**
 * The sample table. `nowMs` is injected so "3 days ago" is stable in a test and
 * true in a browser.
 */
export function samplePeopleRows(
  nowMs: number = nowInstant().epochMilliseconds,
): PeopleRow[] {
  return SAMPLE_PEOPLE.map(({ lastActiveDaysAgo, ...person }) => ({
    ...person,
    lastActiveIso:
      lastActiveDaysAgo === null ? null : daysAgo(lastActiveDaysAgo, nowMs),
  }));
}
