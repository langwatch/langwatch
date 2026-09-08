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

import type { PeopleRow } from "./peopleRows";

const daysAgo = (days: number, nowMs: number) =>
  new Date(nowMs - days * 86_400_000).toISOString();

/** Sample departments, for a Departments tab with none of its own. */
export const SAMPLE_DEPARTMENTS = [
  "Engineering",
  "Customer Support",
  "Finance",
  "Sales",
] as const;

/**
 * The sample table. `nowMs` is injected so "3 days ago" is stable in a test and
 * true in a browser.
 */
export function samplePeopleRows(nowMs = Date.now()): PeopleRow[] {
  return [
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
      lastActiveIso: daysAgo(0, nowMs),
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
      lastActiveIso: daysAgo(1, nowMs),
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
      lastActiveIso: daysAgo(4, nowMs),
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
      lastActiveIso: null,
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
      lastActiveIso: daysAgo(2, nowMs),
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
      lastActiveIso: daysAgo(21, nowMs),
      mostUsedTarget: null,
      actor: null,
      linkedUserId: null,
      isMachine: false,
      needsReview: false,
      suspendedReason: null,
    },
  ];
}
