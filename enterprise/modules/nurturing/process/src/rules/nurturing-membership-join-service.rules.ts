// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type { CioBatchCall, NurturingSignalOf } from "@langwatch/enterprise-nurturing-contract";
import { nowInstant } from "@langwatch/time";

type Joined = Pick<
  NurturingSignalOf<"invite_accepted">,
  "userId" | "organizationId" | "organizationName"
>;

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
    {
      type: "track",
      userId,
      event,
      properties: { organization_id: organizationId, organization_name: organizationName },
    },
  ];
}

/**
 * Decides the calls for a person who accepted an invite into an existing organization. The
 * email has one home: signed_up's send, never here (Alex, "ids only").
 */
export function fireInviteAccepted({
  signal,
}: {
  signal: NurturingSignalOf<"invite_accepted">;
}): CioBatchCall[] {
  return joinedCalls({ joined: signal, event: "joined_via_invite" });
}

/**
 * Decides the calls for a person the SSO domain match added: a new person, so every
 * milestone starts false. No email here: it has one home, signed_up's send.
 */
export function fireSsoAutoAdded({
  signal,
}: {
  signal: NurturingSignalOf<"sso_auto_added">;
}): CioBatchCall[] {
  const { userId } = signal;
  return [
    {
      type: "identify",
      userId,
      traits: {
        has_traces: false,
        has_evaluations: false,
        has_prompts: false,
        has_simulations: false,
        has_subscription: false,
        createdAt: nowInstant().toString({ fractionalSecondDigits: 3 }),
      },
    },
    ...joinedCalls({ joined: signal, event: "joined_via_sso" }),
  ];
}
