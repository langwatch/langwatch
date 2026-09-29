import type { NurturingApi, NurturingSignal } from "@langwatch/enterprise-nurturing-contract";
import type { SubscriberSpec } from "@langwatch/eventing";

import {
  INTEGRATION_METHOD_CHOSEN_EVENT_TYPE,
  INVITE_ACCEPTED_EVENT_TYPE,
  MEMBERS_INVITED_EVENT_TYPE,
  ORGANIZATION_SIGNED_UP_EVENT_TYPE,
  type OrganizationLifecycleEvent,
} from "./organization-lifecycle.events.ts";

export type OrganizationLifecycleNurturingDeps = Pick<NurturingApi, "recordSignal">;

function signalOf(event: OrganizationLifecycleEvent): NurturingSignal {
  const source = {
    sourceEventId: event.id,
    tenantId: String(event.tenantId),
    occurredAt: event.occurredAt,
  };
  switch (event.type) {
    case ORGANIZATION_SIGNED_UP_EVENT_TYPE: {
      const { userId, organizationId, organizationName, signUpData, primaryIntent } = event.data;
      const who = { userId, organizationId, organizationName };
      return { kind: "signed_up", ...source, ...who, signUpData, primaryIntent };
    }
    case MEMBERS_INVITED_EVENT_TYPE: {
      const { userId, teamMemberCount, roles } = event.data;
      return { kind: "team_member_invited", ...source, userId, teamMemberCount, roles };
    }
    case INVITE_ACCEPTED_EVENT_TYPE: {
      const { userId, organizationId, organizationName } = event.data;
      return { kind: "invite_accepted", ...source, userId, organizationId, organizationName };
    }
    case INTEGRATION_METHOD_CHOSEN_EVENT_TYPE: {
      const { userId, selection } = event.data;
      return { kind: "integration_method_chosen", ...source, userId, selection };
    }
  }
}

/** Tells nurturing an organization's sign-up, invitations, acceptances and chosen method (§9). */
export function createOrganizationLifecycleNurturingSubscriber(
  nurturing: OrganizationLifecycleNurturingDeps,
): SubscriberSpec<OrganizationLifecycleEvent> & { fold?: never; map?: never } {
  return {
    events: [
      ORGANIZATION_SIGNED_UP_EVENT_TYPE,
      MEMBERS_INVITED_EVENT_TYPE,
      INVITE_ACCEPTED_EVENT_TYPE,
      INTEGRATION_METHOD_CHOSEN_EVENT_TYPE,
    ],
    handler: (event: OrganizationLifecycleEvent) => nurturing.recordSignal(signalOf(event)),
  };
}
