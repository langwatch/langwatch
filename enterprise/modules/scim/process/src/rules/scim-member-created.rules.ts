// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * SCIM's member-created fact (organization ADR-002): a directory create appends it to the outbox
 * in the membership write's own transaction, and scim_membership records it as an event.
 * Spec: modules/organization/specs/seat-peak.feature
 */
import type { ScimMemberCreatedEventData } from "@langwatch/enterprise-scim-contract";
import type { ProcessStore } from "@langwatch/eventing";

export const SCIM_MEMBERSHIP_PROCESS_NAME = "scimMembership" as const;
export const SCIM_MEMBER_CREATED_INTENT = "recordMemberCreated" as const;
export const SCIM_MEMBERSHIP_PRUNE_INTENT = "pruneMemberCreated" as const;
/** The tenant's one member-created outbox instance. */
const SCIM_MEMBERSHIP_PROCESS_KEY = "members";

type MemberCreatedAppend = Omit<Parameters<ProcessStore["appendIntents"]>[0], "transaction">;

/** The outbox append that carries one member-created fact, keyed by the create's own id. */
export function memberCreatedAppend({
  fact,
}: {
  fact: ScimMemberCreatedEventData;
}): MemberCreatedAppend {
  return {
    ref: {
      processName: SCIM_MEMBERSHIP_PROCESS_NAME,
      projectId: fact.tenantId,
      processKey: SCIM_MEMBERSHIP_PROCESS_KEY,
    },
    tenantId: fact.tenantId,
    sourceEventId: null,
    messages: [
      {
        messageKey: fact.createId,
        intentType: SCIM_MEMBER_CREATED_INTENT,
        payload: fact,
        traceCarrier: {},
      },
    ],
    now: fact.occurredAt,
  };
}
