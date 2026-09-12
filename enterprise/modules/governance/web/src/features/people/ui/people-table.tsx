// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { HStack, Text } from "@chakra-ui/react";
import { Lock } from "lucide-react";
import numeral from "numeral";

import { nowInstant, toEpochMs } from "@langwatch/time";

import type { Department, DepartmentAssignments } from "@langwatch/enterprise-governance-contract";
import type { GovernanceIngestionSourceView } from "../../../behavior/governance-api.ts";

/**
 * A TRIMMED PORT of `platform/app/src/components/governance/PeopleTable.tsx`
 * (587 lines in main): only the six exports the new People screen and
 * `UnifiedPeopleTable` actually call. Main's own file still carries the
 * pre-redesign `PeopleTable`/`PeopleSpendPanel`/`SpendSortChips` components,
 * `SPEND_SORT_LABEL`, `PEOPLE_WINDOW_DAYS/LABEL` and `PEOPLE_EMPTY_COPY` —
 * every one of them superseded by `UnifiedPeopleTable` and unreferenced by
 * anything in main's own tree. Dropped here rather than carried into a module
 * with nothing left to call them; see the merge handoff for the full list.
 *
 * Spec: specs/ai-governance/dashboard/people-tabs.feature
 * Spec: specs/governance/governance-people-screen.feature
 */

/**
 * How a row names its person. An actor is the email the gateway saw, or a
 * user id when it saw none: an email shows its local part as the name with
 * the full address under it; anything else shows as-is.
 */
export function describePerson(actor: string): {
  primary: string;
  secondary: string | null;
  avatarName: string;
} {
  const at = actor.indexOf("@");
  if (at > 0) {
    const local = actor.slice(0, at);
    return {
      primary: local,
      secondary: actor,
      // "jane.doe" reads as two words for the initials, not one.
      avatarName: local.replace(/[._-]+/g, " "),
    };
  }
  return { primary: actor, secondary: null, avatarName: actor };
}

/**
 * The department a spend row rolls up to: the actor matched against a
 * member's id. No match means no department is known, never a guess.
 *
 * DROPPED FROM MAIN: main also matched a member by email
 * (`user.email === actor`), because most actors are the address the gateway
 * saw. `DepartmentAssignableEntity` (the contract's own shape for
 * `departments.assignments`) carries `id`, `name` and `departmentId` only —
 * no email — so that branch has nothing to match against here. Flagged in
 * the merge handoff as a shared-file request against the contract.
 */
export function departmentNameForActor({
  actor,
  assignments,
  departments,
}: {
  actor: string;
  assignments: DepartmentAssignments | undefined;
  departments: readonly Department[] | undefined;
}): string | null {
  if (!assignments || !departments) return null;
  const member = assignments.users.find((user) => user.id === actor);
  if (!member?.departmentId) return null;
  return (
    departments.find((department) => department.id === member.departmentId)
      ?.name ?? null
  );
}

/**
 * The connected source a most-used target names, when it names one at all:
 * an exact match on a source's name or its type. The target is the model the
 * gateway saw most for this person, so most rows match nothing and render a
 * plain chip.
 */
export function sourceForTarget({
  target,
  sources,
}: {
  target: string | null;
  sources: readonly GovernanceIngestionSourceView[] | undefined;
}): GovernanceIngestionSourceView | null {
  if (!target || !sources) return null;
  const wanted = target.toLowerCase();
  return (
    sources.find(
      (source) =>
        source.name.toLowerCase() === wanted ||
        source.sourceType.toLowerCase() === wanted,
    ) ?? null
  );
}

export const formatUsd = (n: number | string) => {
  const v = typeof n === "string" ? Number(n) : n;
  return v === 0 ? "$0.00" : numeral(v).format("$0,0.00");
};

/**
 * "3 days ago", spelled out. A shortened unit ("3d") saves pixels and costs
 * the reader a guess (copywriting.md).
 */
export const formatRelativeTime = (
  date: string | null,
  nowMs: number = nowInstant().epochMilliseconds,
): string => {
  if (!date) return "—";
  const epochMs = toEpochMs(date);
  if (Number.isNaN(epochMs)) return "—";
  const diffMs = nowMs - epochMs;
  if (diffMs < 0) return "just now";
  const plural = (n: number, unit: string) =>
    `${n} ${unit}${n === 1 ? "" : "s"} ago`;
  const sec = Math.floor(diffMs / 1000);
  if (sec < 60) return "just now";
  const min = Math.floor(sec / 60);
  if (min < 60) return plural(min, "minute");
  const hr = Math.floor(min / 60);
  if (hr < 24) return plural(hr, "hour");
  const days = Math.floor(hr / 24);
  return plural(days, "day");
};

/**
 * The plan refusal is expected on a non-Enterprise organization, so it reads
 * as a locked feature rather than as a failure.
 */
export function EnterpriseLockedLine() {
  return (
    <HStack
      role="note"
      gap={2}
      color="fg.muted"
      fontSize="sm"
      paddingY={2}
      data-testid="people-enterprise-locked"
    >
      <Lock size={14} aria-hidden="true" />
      <Text>
        Available on Enterprise plans. Upgrade to see spend and activity per
        person.
      </Text>
    </HStack>
  );
}
