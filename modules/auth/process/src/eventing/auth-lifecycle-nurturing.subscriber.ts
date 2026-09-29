import type { NurturingApi, NurturingSignal } from "@langwatch/enterprise-nurturing-contract";
import type { SubscriberSpec } from "@langwatch/eventing";

import {
  type AuthLifecycleEvent,
  SESSION_STARTED_EVENT_TYPE,
  SSO_AUTO_ADDED_EVENT_TYPE,
} from "./auth-lifecycle.events.ts";

export type AuthLifecycleNurturingDeps = Pick<NurturingApi, "recordSignal">;

function signalOf(event: AuthLifecycleEvent): NurturingSignal {
  const source = {
    sourceEventId: event.id,
    tenantId: String(event.tenantId),
    occurredAt: event.occurredAt,
  };
  switch (event.type) {
    case SESSION_STARTED_EVENT_TYPE:
      // Only a member of an organization is recorded, so nurturing never makes a ghost person.
      return {
        kind: "session_started",
        ...source,
        userId: event.data.userId,
        hasOrganization: true,
      };
    case SSO_AUTO_ADDED_EVENT_TYPE: {
      const { userId, organizationId, organizationName } = event.data;
      return { kind: "sso_auto_added", ...source, userId, organizationId, organizationName };
    }
  }
}

/** Tells nurturing a person's sessions and domain auto-joins, ids only (§9). */
export function createAuthLifecycleNurturingSubscriber(
  nurturing: AuthLifecycleNurturingDeps,
): SubscriberSpec<AuthLifecycleEvent> & { fold?: never; map?: never } {
  return {
    events: [SESSION_STARTED_EVENT_TYPE, SSO_AUTO_ADDED_EVENT_TYPE],
    handler: (event: AuthLifecycleEvent) => nurturing.recordSignal(signalOf(event)),
  };
}
