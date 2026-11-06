// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type { CioBatchCall, NurturingSignalOf } from "@langwatch/enterprise-nurturing-contract";
import type { OrganizationUserRole } from "@langwatch/organization-contract";
import { nowInstant, Temporal } from "@langwatch/time";

import { unixSecondsOf } from "./nurturing-customer-io-timestamp.rules.ts";
import { type KnownTraces, knownTraceTraits } from "./nurturing-member-facts.rules.ts";

type TrackCall = Extract<CioBatchCall, { type: "track" }>;
type Joined = Pick<
  NurturingSignalOf<"invite_accepted">,
  "userId" | "organizationId" | "organizationName" | "role"
>;

/**
 * Joins before this went out under joined_via_invite / joined_via_sso, so a replayed old join
 * must not start the campaign now. 2026-11-06T00:00Z, the day the shared event was introduced.
 */
const JOINED_ORGANIZATION_SINCE = Temporal.Instant.from("2026-11-06T00:00:00Z");

/** Keyed by every role, so a new OrganizationUserRole fails the compile until it is named here. */
const SEAT_BY_ROLE: Readonly<Record<OrganizationUserRole, string>> = {
  ADMIN: "admin",
  MEMBER: "member",
  EXTERNAL: "lite_member",
  DEVELOPER: "developer",
};

/** The stored role is a plain string so old or unknown events parse; this narrows it. */
function isOrganizationUserRole(role: string): role is OrganizationUserRole {
  return Object.hasOwn(SEAT_BY_ROLE, role);
}

/** The Customer.io seat name for a role. */
function seatFor(role: OrganizationUserRole): string {
  return SEAT_BY_ROLE[role];
}

/** The properties every join event carries. */
function joinProperties({
  organizationId,
  organizationName,
  role,
}: Joined): Record<string, string> {
  // A role we cannot name is left out rather than guessed.
  const seat = role && isOrganizationUserRole(role) ? seatFor(role) : undefined;
  return {
    organization_id: organizationId,
    organization_name: organizationName,
    ...(seat ? { seat } : {}),
  };
}

/** Groups the person into the organization they joined and tracks how they came in. */
function joinedCalls({
  joined,
  event,
}: {
  joined: Joined;
  event: "joined_via_invite" | "joined_via_sso";
}): CioBatchCall[] {
  const { userId, organizationId, organizationName } = joined;
  return [
    { type: "group", userId, groupId: organizationId, traits: { name: organizationName } },
    { type: "track", userId, event, properties: joinProperties(joined) },
  ];
}

const JOIN_METHOD = { invite_accepted: "invite", sso_auto_added: "sso" } as const;

/**
 * Decides the one joined_organization track of a join, by invite or by SSO; none for a join from
 * before the event existed. Sent once per person and organization by its delivery, not here.
 */
export function fireJoinedOrganization(
  signal: NurturingSignalOf<"invite_accepted"> | NurturingSignalOf<"sso_auto_added">,
): TrackCall[] {
  if (signal.occurredAt < JOINED_ORGANIZATION_SINCE.epochMilliseconds) return [];
  const { userId, organizationId } = signal;
  return [
    {
      type: "track",
      userId,
      event: "joined_organization",
      // Stable per person and organization, so Customer.io can drop a repeat of this join.
      messageId: `joined_organization:${userId}:${organizationId}`,
      properties: { ...joinProperties(signal), join_method: JOIN_METHOD[signal.kind] },
    },
  ];
}

/**
 * Decides the calls for a person who accepted an invite into an existing organization: known
 * traces reach them, and no traces says nothing. The email has one home: signed_up's send,
 * never here (Alex, "ids only").
 */
export function fireInviteAccepted({
  signal,
  traces,
}: {
  signal: NurturingSignalOf<"invite_accepted">;
  traces: KnownTraces | null;
}): CioBatchCall[] {
  const { userId } = signal;
  return [
    ...(traces?.hasTraces
      ? [{ type: "identify" as const, userId, traits: knownTraceTraits(traces) }]
      : []),
    ...joinedCalls({ joined: signal, event: "joined_via_invite" }),
  ];
}

/**
 * Decides the calls for a person the SSO domain match added: a new person, so every milestone
 * starts false but the traces nurturing knows of. No email here: it has one home, signed_up's send.
 */
export function fireSsoAutoAdded({
  signal,
  traces,
}: {
  signal: NurturingSignalOf<"sso_auto_added">;
  traces: KnownTraces | null;
}): CioBatchCall[] {
  const { userId } = signal;
  return [
    {
      type: "identify",
      userId,
      traits: {
        ...knownTraceTraits(traces),
        has_evaluations: false,
        has_prompts: false,
        has_simulations: false,
        has_subscription: false,
        createdAt: unixSecondsOf(nowInstant().epochMilliseconds),
      },
    },
    ...joinedCalls({ joined: signal, event: "joined_via_sso" }),
  ];
}
