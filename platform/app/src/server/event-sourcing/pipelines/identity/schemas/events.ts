import {
  IDENTIFIER_ATTACHED_EVENT_TYPE,
  IDENTIFIER_DEAD_ENDED_EVENT_TYPE,
  IDENTIFIER_DETACHED_EVENT_TYPE,
  IDENTIFIER_VERIFIED_EVENT_TYPE,
  identifierAttachedPayloadSchema,
  identifierDeadEndedPayloadSchema,
  identifierDetachedPayloadSchema,
  identifierVerifiedPayloadSchema,
  LINK_CONFIRMED_EVENT_TYPE,
  LINK_PROPOSED_EVENT_TYPE,
  LINK_REJECTED_EVENT_TYPE,
  linkConfirmedPayloadSchema,
  linkProposedPayloadSchema,
  linkRejectedPayloadSchema,
  PRIMARY_CHANGED_EVENT_TYPE,
  primaryChangedPayloadSchema,
  USER_ERASED_EVENT_TYPE,
  userErasedPayloadSchema,
} from "@langwatch/identity";
import { z } from "zod";
import { EventSchema } from "../../../domain/types";

/**
 * The identity pipeline's wire schemas: the framework envelope (id,
 * aggregate, tenant, cursor time) over the payloads `@langwatch/identity`
 * declares. What a fact SAYS is the package's; how it travels the event log
 * is the framework's, and this file is where the two meet.
 *
 * Time lives on the envelope: `occurredAt` is business time (a backfilled
 * identifier carries the legacy row's `createdAt`), `createdAt` is
 * ledger-accepted time.
 */

export const identifierAttachedEventSchema = EventSchema.extend({
  type: z.literal(IDENTIFIER_ATTACHED_EVENT_TYPE),
  data: identifierAttachedPayloadSchema,
});
export type IdentifierAttachedEvent = z.infer<
  typeof identifierAttachedEventSchema
>;

export const identifierVerifiedEventSchema = EventSchema.extend({
  type: z.literal(IDENTIFIER_VERIFIED_EVENT_TYPE),
  data: identifierVerifiedPayloadSchema,
});
export type IdentifierVerifiedEvent = z.infer<
  typeof identifierVerifiedEventSchema
>;

export const identifierDeadEndedEventSchema = EventSchema.extend({
  type: z.literal(IDENTIFIER_DEAD_ENDED_EVENT_TYPE),
  data: identifierDeadEndedPayloadSchema,
});
export type IdentifierDeadEndedEvent = z.infer<
  typeof identifierDeadEndedEventSchema
>;

export const primaryChangedEventSchema = EventSchema.extend({
  type: z.literal(PRIMARY_CHANGED_EVENT_TYPE),
  data: primaryChangedPayloadSchema,
});
export type PrimaryChangedEvent = z.infer<typeof primaryChangedEventSchema>;

export const identifierDetachedEventSchema = EventSchema.extend({
  type: z.literal(IDENTIFIER_DETACHED_EVENT_TYPE),
  data: identifierDetachedPayloadSchema,
});
export type IdentifierDetachedEvent = z.infer<
  typeof identifierDetachedEventSchema
>;

export const userErasedEventSchema = EventSchema.extend({
  type: z.literal(USER_ERASED_EVENT_TYPE),
  data: userErasedPayloadSchema,
});
export type UserErasedEvent = z.infer<typeof userErasedEventSchema>;

export const linkProposedEventSchema = EventSchema.extend({
  type: z.literal(LINK_PROPOSED_EVENT_TYPE),
  data: linkProposedPayloadSchema,
});
export type LinkProposedEvent = z.infer<typeof linkProposedEventSchema>;

export const linkConfirmedEventSchema = EventSchema.extend({
  type: z.literal(LINK_CONFIRMED_EVENT_TYPE),
  data: linkConfirmedPayloadSchema,
});
export type LinkConfirmedEvent = z.infer<typeof linkConfirmedEventSchema>;

export const linkRejectedEventSchema = EventSchema.extend({
  type: z.literal(LINK_REJECTED_EVENT_TYPE),
  data: linkRejectedPayloadSchema,
});
export type LinkRejectedEvent = z.infer<typeof linkRejectedEventSchema>;

export const identityEventSchema = z.discriminatedUnion("type", [
  identifierAttachedEventSchema,
  identifierVerifiedEventSchema,
  identifierDeadEndedEventSchema,
  primaryChangedEventSchema,
  identifierDetachedEventSchema,
  userErasedEventSchema,
  linkProposedEventSchema,
  linkConfirmedEventSchema,
  linkRejectedEventSchema,
]);
export type IdentityEvent = z.infer<typeof identityEventSchema>;
