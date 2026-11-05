// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type { OrganizationUserRole } from "@langwatch/organization-contract";
import type { CioBatchCall, NurturingSignalOf } from "@langwatch/enterprise-nurturing-contract";
import { nowInstant } from "@langwatch/time";

import { unixSecondsOf } from "./nurturing-customer-io-timestamp.rules.ts";
import { type KnownTraces, knownTraceTraits } from "./nurturing-member-facts.rules.ts";

type Joined = Pick<
  NurturingSignalOf<"invite_accepted">,
  "userId" | "organizationId" | "organizationName" | "role"
>;

/** Keyed by every role, so a new OrganizationUserRole fails the compile until it is named here. */
const SEAT_BY_ROLE: Readonly<Record<OrganizationUserRole, string>> = {
  ADMIN: "admin",
  MEMBER: "member",
  EXTERNAL: "lite_member",
  DEVELOPER: "developer",
};

/**
 * The Customer.io seat name for a stored role. The stored field stays a plain string so old or
 * unknown events still parse; a role we cannot name is left out rather than guessed.
 */
function seatFor(role: string | undefined): string | undefined {
  return role ? (SEAT_BY_ROLE as Readonly<Record<string, string>>)[role] : undefined;
}

/** Groups the person into the organization they joined and tracks how they came in. */
function joinedCalls({
  joined,
  event,
}: {
  joined: Joined;
  event: "joined_via_invite" | "joined_via_sso";
}): CioBatchCall[] {
  const { userId, organizationId, organizationName, role } = joined;
  const seat = seatFor(role);
  return [
    { type: "group", userId, groupId: organizationId, traits: { name: organizationName } },
    {
      type: "track",
      userId,
      event,
      properties: {
        organization_id: organizationId,
        organization_name: organizationName,
        ...(seat ? { seat } : {}),
      },
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
