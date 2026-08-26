import {
  CONNECTION_ACTIVATED_EVENT_TYPE,
  CONNECTION_ARRIVAL_POLICY_SET_EVENT_TYPE,
  CONNECTION_DISCARDED_EVENT_TYPE,
  CONNECTION_REGISTERED_EVENT_TYPE,
  CONNECTION_RESUMED_EVENT_TYPE,
  CONNECTION_SUSPENDED_EVENT_TYPE,
  CONNECTION_TORN_DOWN_EVENT_TYPE,
  connectionActivatedPayloadSchema,
  connectionArrivalPolicySetPayloadSchema,
  connectionDiscardedPayloadSchema,
  connectionRegisteredPayloadSchema,
  connectionResumedPayloadSchema,
  connectionSuspendedPayloadSchema,
  connectionTornDownPayloadSchema,
  DOMAIN_ATTESTED_EVENT_TYPE,
  DOMAIN_CLAIM_APPROVED_EVENT_TYPE,
  DOMAIN_CLAIM_REJECTED_EVENT_TYPE,
  DOMAIN_CLAIMED_EVENT_TYPE,
  DOMAIN_PROOF_LAPSED_EVENT_TYPE,
  DOMAIN_PROOF_RECOVERED_EVENT_TYPE,
  DOMAIN_PROOF_WAVERED_EVENT_TYPE,
  DOMAIN_VERIFIED_EVENT_TYPE,
  DOMAIN_WITHDRAWN_EVENT_TYPE,
  domainAttestedPayloadSchema,
  domainClaimApprovedPayloadSchema,
  domainClaimedPayloadSchema,
  domainClaimRejectedPayloadSchema,
  domainProofLapsedPayloadSchema,
  domainProofRecoveredPayloadSchema,
  domainProofWaveredPayloadSchema,
  domainVerifiedPayloadSchema,
  domainWithdrawnPayloadSchema,
  TEARDOWN_REQUESTED_EVENT_TYPE,
  teardownRequestedPayloadSchema,
  VERIFICATION_REQUESTED_EVENT_TYPE,
  verificationRequestedPayloadSchema,
} from "@langwatch/identity";
import { z } from "zod";
import { EventSchema } from "../../../domain/types";

/**
 * The connection pipeline's wire schemas: the framework envelope (id,
 * aggregate, tenant, cursor time) over the payloads `@langwatch/identity`
 * declares. What a fact SAYS is the package's; how it travels the event log
 * is the framework's, and this file is where the two meet — the same split
 * the identity pipeline's `schemas/events.ts` makes one aggregate over.
 *
 * Time lives on the envelope: `occurredAt` is business time (a grandfathered
 * connection's history carries the migration's pass time), `createdAt` is
 * ledger-accepted time.
 */

export const connectionRegisteredEventSchema = EventSchema.extend({
  type: z.literal(CONNECTION_REGISTERED_EVENT_TYPE),
  data: connectionRegisteredPayloadSchema,
});
export type ConnectionRegisteredEvent = z.infer<
  typeof connectionRegisteredEventSchema
>;

export const domainClaimedEventSchema = EventSchema.extend({
  type: z.literal(DOMAIN_CLAIMED_EVENT_TYPE),
  data: domainClaimedPayloadSchema,
});
export type DomainClaimedEvent = z.infer<typeof domainClaimedEventSchema>;

export const domainClaimApprovedEventSchema = EventSchema.extend({
  type: z.literal(DOMAIN_CLAIM_APPROVED_EVENT_TYPE),
  data: domainClaimApprovedPayloadSchema,
});
export type DomainClaimApprovedEvent = z.infer<
  typeof domainClaimApprovedEventSchema
>;

export const domainClaimRejectedEventSchema = EventSchema.extend({
  type: z.literal(DOMAIN_CLAIM_REJECTED_EVENT_TYPE),
  data: domainClaimRejectedPayloadSchema,
});
export type DomainClaimRejectedEvent = z.infer<
  typeof domainClaimRejectedEventSchema
>;

export const connectionDiscardedEventSchema = EventSchema.extend({
  type: z.literal(CONNECTION_DISCARDED_EVENT_TYPE),
  data: connectionDiscardedPayloadSchema,
});
export type ConnectionDiscardedEvent = z.infer<
  typeof connectionDiscardedEventSchema
>;

export const verificationRequestedEventSchema = EventSchema.extend({
  type: z.literal(VERIFICATION_REQUESTED_EVENT_TYPE),
  data: verificationRequestedPayloadSchema,
});
export type VerificationRequestedEvent = z.infer<
  typeof verificationRequestedEventSchema
>;

export const domainAttestedEventSchema = EventSchema.extend({
  type: z.literal(DOMAIN_ATTESTED_EVENT_TYPE),
  data: domainAttestedPayloadSchema,
});
export type DomainAttestedEvent = z.infer<typeof domainAttestedEventSchema>;

export const domainWithdrawnEventSchema = EventSchema.extend({
  type: z.literal(DOMAIN_WITHDRAWN_EVENT_TYPE),
  data: domainWithdrawnPayloadSchema,
});
export type DomainWithdrawnEvent = z.infer<typeof domainWithdrawnEventSchema>;

export const domainVerifiedEventSchema = EventSchema.extend({
  type: z.literal(DOMAIN_VERIFIED_EVENT_TYPE),
  data: domainVerifiedPayloadSchema,
});
export type DomainVerifiedEvent = z.infer<typeof domainVerifiedEventSchema>;

export const connectionActivatedEventSchema = EventSchema.extend({
  type: z.literal(CONNECTION_ACTIVATED_EVENT_TYPE),
  data: connectionActivatedPayloadSchema,
});
export type ConnectionActivatedEvent = z.infer<
  typeof connectionActivatedEventSchema
>;

export const connectionSuspendedEventSchema = EventSchema.extend({
  type: z.literal(CONNECTION_SUSPENDED_EVENT_TYPE),
  data: connectionSuspendedPayloadSchema,
});
export type ConnectionSuspendedEvent = z.infer<
  typeof connectionSuspendedEventSchema
>;

export const connectionResumedEventSchema = EventSchema.extend({
  type: z.literal(CONNECTION_RESUMED_EVENT_TYPE),
  data: connectionResumedPayloadSchema,
});
export type ConnectionResumedEvent = z.infer<
  typeof connectionResumedEventSchema
>;

export const teardownRequestedEventSchema = EventSchema.extend({
  type: z.literal(TEARDOWN_REQUESTED_EVENT_TYPE),
  data: teardownRequestedPayloadSchema,
});
export type TeardownRequestedEvent = z.infer<
  typeof teardownRequestedEventSchema
>;

export const connectionTornDownEventSchema = EventSchema.extend({
  type: z.literal(CONNECTION_TORN_DOWN_EVENT_TYPE),
  data: connectionTornDownPayloadSchema,
});
export type ConnectionTornDownEvent = z.infer<
  typeof connectionTornDownEventSchema
>;

/** Who this connection admits, stated (ADR-117 §3). */
export const connectionArrivalPolicySetEventSchema = EventSchema.extend({
  type: z.literal(CONNECTION_ARRIVAL_POLICY_SET_EVENT_TYPE),
  data: connectionArrivalPolicySetPayloadSchema,
});
export type ConnectionArrivalPolicySetEvent = z.infer<
  typeof connectionArrivalPolicySetEventSchema
>;

/*
 * WHAT A RE-CHECK SAW (ADR-123). These three had no wire schema at all: the
 * aggregate states them, the fold reads them, and the pipeline's union did
 * not list them — so an envelope carrying one was assignable to nothing and
 * the only reason nobody noticed is that `fact.type` was a union wide enough
 * to look fine until another member joined it. Adding one event made the
 * compiler name all four.
 */
export const domainProofWaveredEventSchema = EventSchema.extend({
  type: z.literal(DOMAIN_PROOF_WAVERED_EVENT_TYPE),
  data: domainProofWaveredPayloadSchema,
});
export type DomainProofWaveredEvent = z.infer<
  typeof domainProofWaveredEventSchema
>;

export const domainProofLapsedEventSchema = EventSchema.extend({
  type: z.literal(DOMAIN_PROOF_LAPSED_EVENT_TYPE),
  data: domainProofLapsedPayloadSchema,
});
export type DomainProofLapsedEvent = z.infer<
  typeof domainProofLapsedEventSchema
>;

export const domainProofRecoveredEventSchema = EventSchema.extend({
  type: z.literal(DOMAIN_PROOF_RECOVERED_EVENT_TYPE),
  data: domainProofRecoveredPayloadSchema,
});
export type DomainProofRecoveredEvent = z.infer<
  typeof domainProofRecoveredEventSchema
>;

export const ssoConnectionEventSchema = z.discriminatedUnion("type", [
  connectionRegisteredEventSchema,
  domainClaimedEventSchema,
  domainClaimApprovedEventSchema,
  domainClaimRejectedEventSchema,
  connectionDiscardedEventSchema,
  verificationRequestedEventSchema,
  domainAttestedEventSchema,
  domainWithdrawnEventSchema,
  domainVerifiedEventSchema,
  connectionActivatedEventSchema,
  connectionSuspendedEventSchema,
  connectionResumedEventSchema,
  teardownRequestedEventSchema,
  connectionTornDownEventSchema,
  connectionArrivalPolicySetEventSchema,
  domainProofWaveredEventSchema,
  domainProofLapsedEventSchema,
  domainProofRecoveredEventSchema,
]);
export type SsoConnectionEvent = z.infer<typeof ssoConnectionEventSchema>;
