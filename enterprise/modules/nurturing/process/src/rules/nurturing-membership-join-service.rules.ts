// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type { CioBatchCall, NurturingSignalOf } from "@langwatch/enterprise-nurturing-contract";
import type { OrganizationUserRole } from "@langwatch/organization-contract";
import { nowInstant, Temporal } from "@langwatch/time";

import { unixSecondsOf } from "./nurturing-customer-io-timestamp.rules.ts";
import { type KnownTraces, knownTraceTraits } from "./nurturing-member-facts.rules.ts";

type Joined = Pick<
  NurturingSignalOf<"invite_accepted">,
  "userId" | "organizationId" | "organizationName" | "role" | "occurredAt"
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

const JOINED_VIA = { invite: "joined_via_invite", sso: "joined_via_sso" } as const;

/** Groups the person into the organization they joined and tracks that they joined, with how. */
function joinedCalls({
  joined,
  joinMethod,
  firstJoin,
}: {
  joined: Joined;
  joinMethod: "invite" | "sso";
  /** False when this person already got joined_organization for this organization. */
  firstJoin: boolean;
}): CioBatchCall[] {
  const { userId, organizationId, organizationName, role, occurredAt } = joined;
  // A role we cannot name is left out rather than guessed.
  const seat = role && isOrganizationUserRole(role) ? seatFor(role) : undefined;
  const group: CioBatchCall = {
    type: "group",
    userId,
    groupId: organizationId,
    traits: { name: organizationName },
  };
  const properties = {
    organization_id: organizationId,
    organization_name: organizationName,
    ...(seat ? { seat } : {}),
  };
  const calls: CioBatchCall[] = [
    group,
    { type: "track", userId, event: JOINED_VIA[joinMethod], properties },
  ];
  if (firstJoin && occurredAt >= JOINED_ORGANIZATION_SINCE.epochMilliseconds) {
    calls.push({
      type: "track",
      userId,
      event: "joined_organization",
      // Stable per person and organization, so Customer.io drops a repeat of this join.
      messageId: `joined_organization:${userId}:${organizationId}`,
      properties: { ...properties, join_method: joinMethod },
    });
  }
  return calls;
}

/**
 * Decides the calls for a person who accepted an invite into an existing organization: known
 * traces reach them, and no traces says nothing. The email has one home: signed_up's send,
 * never here (Alex, "ids only").
 */
export function fireInviteAccepted({
  signal,
  traces,
  firstJoin,
}: {
  signal: NurturingSignalOf<"invite_accepted">;
  traces: KnownTraces | null;
  firstJoin: boolean;
}): CioBatchCall[] {
  const { userId } = signal;
  return [
    ...(traces?.hasTraces
      ? [{ type: "identify" as const, userId, traits: knownTraceTraits(traces) }]
      : []),
    ...joinedCalls({ joined: signal, joinMethod: "invite", firstJoin }),
  ];
}

/**
 * Decides the calls for a person the SSO domain match added: a new person, so every milestone
 * starts false but the traces nurturing knows of. No email here: it has one home, signed_up's send.
 */
export function fireSsoAutoAdded({
  signal,
  traces,
  firstJoin,
}: {
  signal: NurturingSignalOf<"sso_auto_added">;
  traces: KnownTraces | null;
  firstJoin: boolean;
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
    ...joinedCalls({ joined: signal, joinMethod: "sso", firstJoin }),
  ];
}
