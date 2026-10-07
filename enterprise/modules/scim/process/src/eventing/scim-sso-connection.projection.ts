// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * SCIM's own copy of an organization's SSO connections: a peer fold (§9) over identity's facts with
 * identity-contract's reducer, per connection, in order; existing ones arrive by a projection replay.
 * Spec: enterprise/modules/scim/specs/scim-sso-connection-view.feature
 */
import type {
  FoldProjectionStore,
  PeerEvent,
  PeerFoldProjectionDeclaration,
} from "@langwatch/eventing";
import {
  CONNECTION_ACTIVATED_EVENT_TYPE,
  CONNECTION_ARRIVAL_POLICY_SET_EVENT_TYPE,
  CONNECTION_DISCARDED_EVENT_TYPE,
  CONNECTION_IDP_UPDATED_EVENT_TYPE,
  CONNECTION_REGISTERED_EVENT_TYPE,
  CONNECTION_RENAMED_EVENT_TYPE,
  CONNECTION_RESUMED_EVENT_TYPE,
  CONNECTION_SUSPENDED_EVENT_TYPE,
  CONNECTION_TORN_DOWN_EVENT_TYPE,
  DOMAIN_ATTESTED_EVENT_TYPE,
  DOMAIN_CLAIM_APPROVED_EVENT_TYPE,
  DOMAIN_CLAIM_REJECTED_EVENT_TYPE,
  DOMAIN_CLAIMED_EVENT_TYPE,
  DOMAIN_PROOF_LAPSED_EVENT_TYPE,
  DOMAIN_PROOF_RECOVERED_EVENT_TYPE,
  DOMAIN_PROOF_WAVERED_EVENT_TYPE,
  DOMAIN_VERIFIED_EVENT_TYPE,
  DOMAIN_WITHDRAWN_EVENT_TYPE,
  MIGRATION_FINALIZATION_STARTED_EVENT_TYPE,
  MIGRATION_FINALIZED_EVENT_TYPE,
  MIGRATION_ROUTE_SELECTED_EVENT_TYPE,
  REPLACEMENT_CONNECTION_REGISTERED_EVENT_TYPE,
  TEARDOWN_REQUESTED_EVENT_TYPE,
  VERIFICATION_REQUESTED_EVENT_TYPE,
  connectionActivatedPayloadSchema,
  connectionArrivalPolicySetPayloadSchema,
  connectionDiscardedPayloadSchema,
  connectionIdpUpdatedPayloadSchema,
  connectionRegisteredPayloadSchema,
  connectionRenamedPayloadSchema,
  connectionResumedPayloadSchema,
  connectionSuspendedPayloadSchema,
  connectionTornDownPayloadSchema,
  domainAttestedPayloadSchema,
  domainClaimApprovedPayloadSchema,
  domainClaimRejectedPayloadSchema,
  domainClaimedPayloadSchema,
  domainProofLapsedPayloadSchema,
  domainProofRecoveredPayloadSchema,
  domainProofWaveredPayloadSchema,
  domainVerifiedPayloadSchema,
  domainWithdrawnPayloadSchema,
  emptySsoConnection,
  migrationFinalizationStartedPayloadSchema,
  migrationFinalizedPayloadSchema,
  migrationRouteSelectedPayloadSchema,
  reduceSsoConnection,
  replacementConnectionRegisteredPayloadSchema,
  teardownRequestedPayloadSchema,
  verificationRequestedPayloadSchema,
} from "@langwatch/identity-contract";

import {
  SCIM_SSO_CONNECTION_PROJECTION_VERSION,
  type ScimSsoConnectionFoldState,
} from "../repositories/scim-sso-connection.repository.ts";

export type { ScimSsoConnectionFoldState };

/** The fold's name; its global lane is `<host pipeline>.ssoConnections`. */
export const SCIM_SSO_CONNECTION_PROJECTION_NAME = "ssoConnections" as const;

/** Every identity connection fact SCIM folds, each parsed by identity-contract's own schema. */
export const scimSsoConnectionPeerEvents = [
  { type: CONNECTION_ARRIVAL_POLICY_SET_EVENT_TYPE, data: connectionArrivalPolicySetPayloadSchema },
  { type: CONNECTION_REGISTERED_EVENT_TYPE, data: connectionRegisteredPayloadSchema },
  { type: DOMAIN_CLAIMED_EVENT_TYPE, data: domainClaimedPayloadSchema },
  { type: DOMAIN_CLAIM_APPROVED_EVENT_TYPE, data: domainClaimApprovedPayloadSchema },
  { type: DOMAIN_CLAIM_REJECTED_EVENT_TYPE, data: domainClaimRejectedPayloadSchema },
  { type: CONNECTION_DISCARDED_EVENT_TYPE, data: connectionDiscardedPayloadSchema },
  { type: VERIFICATION_REQUESTED_EVENT_TYPE, data: verificationRequestedPayloadSchema },
  { type: DOMAIN_ATTESTED_EVENT_TYPE, data: domainAttestedPayloadSchema },
  { type: DOMAIN_WITHDRAWN_EVENT_TYPE, data: domainWithdrawnPayloadSchema },
  { type: DOMAIN_VERIFIED_EVENT_TYPE, data: domainVerifiedPayloadSchema },
  { type: DOMAIN_PROOF_WAVERED_EVENT_TYPE, data: domainProofWaveredPayloadSchema },
  { type: DOMAIN_PROOF_LAPSED_EVENT_TYPE, data: domainProofLapsedPayloadSchema },
  { type: DOMAIN_PROOF_RECOVERED_EVENT_TYPE, data: domainProofRecoveredPayloadSchema },
  { type: CONNECTION_ACTIVATED_EVENT_TYPE, data: connectionActivatedPayloadSchema },
  { type: CONNECTION_SUSPENDED_EVENT_TYPE, data: connectionSuspendedPayloadSchema },
  { type: CONNECTION_RESUMED_EVENT_TYPE, data: connectionResumedPayloadSchema },
  { type: TEARDOWN_REQUESTED_EVENT_TYPE, data: teardownRequestedPayloadSchema },
  { type: CONNECTION_TORN_DOWN_EVENT_TYPE, data: connectionTornDownPayloadSchema },
  { type: CONNECTION_RENAMED_EVENT_TYPE, data: connectionRenamedPayloadSchema },
  { type: CONNECTION_IDP_UPDATED_EVENT_TYPE, data: connectionIdpUpdatedPayloadSchema },
  {
    type: REPLACEMENT_CONNECTION_REGISTERED_EVENT_TYPE,
    data: replacementConnectionRegisteredPayloadSchema,
  },
  { type: MIGRATION_ROUTE_SELECTED_EVENT_TYPE, data: migrationRouteSelectedPayloadSchema },
  {
    type: MIGRATION_FINALIZATION_STARTED_EVENT_TYPE,
    data: migrationFinalizationStartedPayloadSchema,
  },
  { type: MIGRATION_FINALIZED_EVENT_TYPE, data: migrationFinalizedPayloadSchema },
] as const;

export type ScimSsoConnectionPeerEvent = PeerEvent<typeof scimSsoConnectionPeerEvents>;

/** Identity's reducer over one fact; the first fact names the connection init() could not. */
export function foldScimSsoConnection(
  state: ScimSsoConnectionFoldState,
  event: ScimSsoConnectionPeerEvent,
): ScimSsoConnectionFoldState {
  const next = reduceSsoConnection({ state, fact: event });
  return {
    ...next,
    connectionId: next.connectionId === "" ? String(event.aggregateId) : next.connectionId,
    LastEventOccurredAt: Math.max(state.LastEventOccurredAt, event.occurredAt),
  };
}

/** The peer fold SCIM hosts on its own pipeline, over its own store. */
export function scimSsoConnectionPeerFold(
  store: FoldProjectionStore<ScimSsoConnectionFoldState>,
): PeerFoldProjectionDeclaration<ScimSsoConnectionFoldState, typeof scimSsoConnectionPeerEvents> {
  return {
    events: scimSsoConnectionPeerEvents,
    fold: {
      name: SCIM_SSO_CONNECTION_PROJECTION_NAME,
      version: SCIM_SSO_CONNECTION_PROJECTION_VERSION,
      eventTypes: scimSsoConnectionPeerEvents.map(({ type }) => type),
      init: () => ({ ...emptySsoConnection({ connectionId: "" }), LastEventOccurredAt: 0 }),
      apply: foldScimSsoConnection,
      store,
      LastEventOccurredAtKey: "LastEventOccurredAt",
    },
  };
}
