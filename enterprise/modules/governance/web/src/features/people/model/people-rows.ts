// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * The People screen's one table, built from the two reads that used to be two
 * tables.
 *
 * The activity monitor meters money against an `actor` — the address or user
 * id the gateway saw. The identity feed writes a `DiscoveredPerson` per
 * provider that named somebody. They describe one population, so the screen
 * shows one table; joining them is this module's whole job, and the join is
 * deliberately timid.
 *
 * Deciding that two identifiers are the same human is the match engine's
 * decision (ADR-128 section 12), never a table's. So a spend row joins a
 * discovered person only when EXACTLY ONE non-erased discovered person carries
 * that identifier. Two providers naming the same address stay two rows, and
 * the money they both claim stays on a row of its own rather than being shown
 * on both — one measurement rendered twice would double the organization's
 * spend on screen, and picking a winner would be the unproven match again by
 * another route.
 *
 * Framework-free on purpose: the table renders it, the page filters it, and a
 * test can call it with literals.
 *
 * Spec: specs/ai-governance/dashboard/people-tabs.feature
 * Spec: specs/governance/governance-people-screen.feature
 */

import { toEpochMs } from "@langwatch/time";

import {
  departmentLabelFor,
  type PersonDepartmentFacts,
} from "./observed-departments.ts";

/** What a row needs from the activity monitor's per-person spend read. */
export interface SpendFacts {
  actor: string;
  spendUsd: number | string;
  requests: number;
  lastActivityIso: string | null;
  mostUsedTarget: string | null;
}

/** What a row needs from the identity feed's discovered-people read. */
export interface DiscoveredFacts extends PersonDepartmentFacts {
  id: string;
  provider: string;
  kind: string;
  displayText: string;
  rawActorId: string;
  /** ISO strings: the wire's own shape, never a `Date`. */
  firstSeenAt: string;
  lastSeenAt: string;
  suspendedAt: string | null;
  suspendedReason: string | null;
  link: {
    userId: string;
    evidenceKind: string;
    memberName: string | null;
    departmentName: string | null;
  } | null;
}

/**
 * Whether the screen knows which account is behind a row.
 *
 * `erased` wins over everything: a row we were asked to forget is described by
 * its status and nothing else. `matched` covers both ways of knowing — a proof
 * link the match engine opened, and a spend actor that is an organization
 * member's own address, which is the same join the department column makes.
 * Everything else is `unmatched`, which is the ordinary state on a tenant that
 * has never run the engine.
 */
export type PersonMatchStatus = "matched" | "unmatched" | "erased";

export interface PeopleRow {
  /** Stable across reads; a discovered person's id, else the spend actor. */
  key: string;
  /** The name the row leads with. For an erased person, their pseudonym. */
  displayName: string;
  /** Beneath the name. Never set for an erased person. */
  identifier: string | null;
  /** The provider that named them, when one did. Never set for an erased person. */
  provider: string | null;
  status: PersonMatchStatus;
  /** How we know the account, in the reader's words. Null when we do not. */
  matchDetail: string | null;
  /** The engine's proof, when a link is what told us. */
  evidenceKind: string | null;
  department: string | null;
  /** Null when nothing metered this person: not measured, not zero. */
  spendUsd: number | null;
  requests: number | null;
  lastActiveIso: string | null;
  /** The model or tool the gateway saw most, when it saw any. */
  mostUsedTarget: string | null;
  /** The actor the detail page is keyed by, when the spend read knows one. */
  actor: string | null;
  /** The member this row is proven to be, for the assign-department action. */
  linkedUserId: string | null;
  isMachine: boolean;
  needsReview: boolean;
  suspendedReason: string | null;
}

const asNumber = (value: number | string): number =>
  typeof value === "string" ? Number(value) : value;

const asTime = (value: string): number => {
  const epochMs = toEpochMs(value);
  return Number.isNaN(epochMs) ? 0 : epochMs;
};

const isErased = (person: DiscoveredFacts) => person.erasedAt !== null;

/**
 * The identifiers a discovered person can be joined on, by provider-side
 * identity. Erased people are excluded: their stored identifier is already a
 * pseudonym, and a pseudonym that happened to collide with a live actor must
 * never pull that actor's money onto a row we were asked to forget.
 */
function claimantsByIdentifier(
  discovered: readonly DiscoveredFacts[],
): Map<string, DiscoveredFacts[]> {
  const byIdentifier = new Map<string, DiscoveredFacts[]>();
  for (const person of discovered) {
    if (isErased(person)) continue;
    const existing = byIdentifier.get(person.rawActorId);
    if (existing) existing.push(person);
    else byIdentifier.set(person.rawActorId, [person]);
  }
  return byIdentifier;
}

function statusOf({
  person,
  memberName,
}: {
  person: DiscoveredFacts | null;
  memberName: string | null;
}): {
  status: PersonMatchStatus;
  matchDetail: string | null;
  evidenceKind: string | null;
} {
  if (person && isErased(person)) {
    return { status: "erased", matchDetail: null, evidenceKind: null };
  }
  if (person?.link) {
    return {
      status: "matched",
      matchDetail: person.link.memberName ?? person.link.userId,
      evidenceKind: person.link.evidenceKind,
    };
  }
  if (memberName) {
    return { status: "matched", matchDetail: memberName, evidenceKind: null };
  }
  return { status: "unmatched", matchDetail: null, evidenceKind: null };
}

/**
 * The row a metered actor gets, and the discovered person it was allowed to be
 * shown as, when it was allowed one at all.
 *
 * Split from the merge below because the two answer different questions. The
 * merge decides WHICH discovered person a spend row may claim, which is the
 * timid decision this module exists to make. This decides what the reader then
 * sees in each column, which is a long list of "the person's version if we have
 * a person, the raw actor otherwise". Kept in one place they read as a single
 * thing, and neither of them is legible.
 */
function spendRowFor({
  spend,
  person,
  memberName,
  departmentForActor,
}: {
  spend: SpendFacts;
  /** The single discovered person this actor may be shown as, if there is one. */
  person: DiscoveredFacts | null;
  memberName: string | null;
  departmentForActor: (actor: string) => string | null;
}): PeopleRow {
  const { status, matchDetail, evidenceKind } = statusOf({
    person,
    memberName,
  });
  return {
    key: person?.id ?? `spend:${spend.actor}`,
    displayName: person?.displayText ?? spend.actor,
    identifier: person ? person.rawActorId : spend.actor,
    provider: person?.provider ?? null,
    status,
    matchDetail,
    evidenceKind,
    department:
      (person ? departmentLabelFor(person) : null) ??
      departmentForActor(spend.actor),
    spendUsd: asNumber(spend.spendUsd),
    requests: spend.requests,
    lastActiveIso: spend.lastActivityIso,
    mostUsedTarget: spend.mostUsedTarget,
    actor: spend.actor,
    linkedUserId: person?.link?.userId ?? null,
    isMachine: person ? person.kind !== "person" : false,
    needsReview: person?.suspendedAt != null,
    suspendedReason: person?.suspendedReason ?? null,
  } satisfies PeopleRow;
}

/**
 * The row a person gets when a provider named them and nothing ever metered
 * them.
 *
 * Its own function for the same reason as the spend row above: what an erased
 * person is allowed to show is a rule in its own right, and it deserves to be
 * read on its own rather than as the second half of something longer.
 */
function discoveredRowFor(person: DiscoveredFacts): PeopleRow {
  const erased = isErased(person);
  const { status, matchDetail, evidenceKind } = statusOf({
    person,
    memberName: null,
  });
  return {
    key: person.id,
    displayName: person.displayText,
    // An erased row is described by its stand-in and nothing else, even if
    // a value survived upstream that erasure was supposed to blank.
    identifier: erased ? null : person.rawActorId,
    provider: erased ? null : person.provider,
    status,
    matchDetail,
    evidenceKind,
    department: departmentLabelFor(person),
    // Nothing metered them, so there is no spend and no request count. When
    // a provider last named them is a real measurement though, and it is
    // the same question "last active" asks.
    spendUsd: null,
    requests: null,
    lastActiveIso: person.lastSeenAt,
    mostUsedTarget: null,
    actor: null,
    linkedUserId: person.link?.userId ?? null,
    isMachine: person.kind !== "person",
    needsReview: person.suspendedAt != null,
    suspendedReason: person.suspendedReason,
  } satisfies PeopleRow;
}

/**
 * Most recently seen first, and by name when two were seen at the same moment.
 *
 * Named rather than written inline so the reason for the tie-break sits with
 * it: without one, two people a provider reported in the same pull could swap
 * places between reads, and the table would look unstable for no reason.
 */
const byMostRecentlySeen = (a: DiscoveredFacts, b: DiscoveredFacts) =>
  asTime(b.lastSeenAt) - asTime(a.lastSeenAt) ||
  a.displayText.localeCompare(b.displayText);

/**
 * The one table, ordered the way the reader asked for it.
 *
 * Rows carrying money keep the order the spend read returned, because that read
 * is what the sort chip drives. Rows the gateway never metered follow, most
 * recently seen first — they have no figure the chosen sort could rank them by,
 * and interleaving them by name would push spenders below people who have never
 * cost anything.
 */
export function mergePeopleRows({
  spend,
  discovered,
  departmentForActor,
  memberNameForActor,
}: {
  spend: readonly SpendFacts[];
  discovered: readonly DiscoveredFacts[];
  /** The department an organization member with this actor is assigned to. */
  departmentForActor: (actor: string) => string | null;
  /** The member name behind this actor, when the organization has one. */
  memberNameForActor: (actor: string) => string | null;
}): PeopleRow[] {
  const claimants = claimantsByIdentifier(discovered);
  const joined = new Set<string>();

  const spendRows = spend.map((row) => {
    const claims = claimants.get(row.actor) ?? [];
    // One claimant is a join the screen is allowed to make. Two is the match
    // engine's question, so the money stays on its own row and says so.
    const person = claims.length === 1 ? (claims[0] ?? null) : null;
    if (person) joined.add(person.id);
    return spendRowFor({
      spend: row,
      person,
      memberName: memberNameForActor(row.actor),
      departmentForActor,
    });
  });

  const discoveredRows = discovered
    .filter((person) => !joined.has(person.id))
    .sort(byMostRecentlySeen)
    .map((person) => discoveredRowFor(person));

  return [...spendRows, ...discoveredRows];
}

/** Every department name any row on the table shows, for the filter chip. */
export function departmentsPresent(rows: readonly PeopleRow[]): string[] {
  return [
    ...new Set(
      rows
        .map((row) => row.department)
        .filter((name): name is string => !!name),
    ),
  ].sort((a, b) => a.localeCompare(b));
}

/** The rows a department choice leaves on screen. `null` means all of them. */
export function filterByDepartment({
  rows,
  department,
}: {
  rows: readonly PeopleRow[];
  department: string | null;
}): PeopleRow[] {
  if (department === null) return [...rows];
  return rows.filter((row) => row.department === department);
}
