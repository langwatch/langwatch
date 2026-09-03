import {
  CONNECTION_ACTIVATED_EVENT_TYPE,
  CONNECTION_DISCARDED_EVENT_TYPE,
  CONNECTION_REGISTERED_EVENT_TYPE,
  CONNECTION_RESUMED_EVENT_TYPE,
  CONNECTION_SUSPENDED_EVENT_TYPE,
  CONNECTION_TORN_DOWN_EVENT_TYPE,
  connectionActivatedPayloadSchema,
  connectionDiscardedPayloadSchema,
  connectionRegisteredPayloadSchema,
  connectionResumedPayloadSchema,
  connectionSuspendedPayloadSchema,
  connectionTornDownPayloadSchema,
  DOMAIN_ATTESTED_EVENT_TYPE,
  DOMAIN_CLAIM_APPROVED_EVENT_TYPE,
  DOMAIN_CLAIM_REJECTED_EVENT_TYPE,
  DOMAIN_CLAIMED_EVENT_TYPE,
  DOMAIN_VERIFIED_EVENT_TYPE,
  domainAttestedPayloadSchema,
  domainClaimApprovedPayloadSchema,
  domainClaimedPayloadSchema,
  domainClaimRejectedPayloadSchema,
  domainVerifiedPayloadSchema,
  TEARDOWN_REQUESTED_EVENT_TYPE,
  teardownRequestedPayloadSchema,
  VERIFICATION_REQUESTED_EVENT_TYPE,
  verificationRequestedPayloadSchema,
} from "@langwatch/identity-contract";
import { z } from "zod";
import { EventSchema } from "@langwatch/eventing";

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

export const ssoConnectionEventSchema = z.discriminatedUnion("type", [
  connectionRegisteredEventSchema,
  domainClaimedEventSchema,
  domainClaimApprovedEventSchema,
  domainClaimRejectedEventSchema,
  connectionDiscardedEventSchema,
  verificationRequestedEventSchema,
  domainAttestedEventSchema,
  domainVerifiedEventSchema,
  connectionActivatedEventSchema,
  connectionSuspendedEventSchema,
  connectionResumedEventSchema,
  teardownRequestedEventSchema,
  connectionTornDownEventSchema,
]);
export type SsoConnectionEvent = z.infer<typeof ssoConnectionEventSchema>;
