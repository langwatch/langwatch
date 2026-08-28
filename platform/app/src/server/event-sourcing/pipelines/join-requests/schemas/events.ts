import {
  JOIN_APPROVED_EVENT_TYPE,
  JOIN_EXPIRED_EVENT_TYPE,
  JOIN_REJECTED_EVENT_TYPE,
  JOIN_REQUESTED_EVENT_TYPE,
  JOIN_WITHDRAWN_EVENT_TYPE,
  joinApprovedPayloadSchema,
  joinExpiredPayloadSchema,
  joinRejectedPayloadSchema,
  joinRequestedPayloadSchema,
  joinWithdrawnPayloadSchema,
} from "@langwatch/identity";
import { z } from "zod";
import { EventSchema } from "@langwatch/eventing";

/**
 * The join-request pipeline's wire schemas: the framework envelope (id,
 * aggregate, tenant, cursor time) over the payloads `@langwatch/identity`
 * declares. What a fact SAYS is the package's; how it travels the event log
 * is the framework's, and this file is where the two meet.
 *
 * Time lives on the envelope: `occurredAt` is business time (an expiry
 * carries the deadline it was scheduled for, not the moment the worker got
 * round to it), `createdAt` is ledger-accepted time.
 */

export const joinRequestedEventSchema = EventSchema.extend({
  type: z.literal(JOIN_REQUESTED_EVENT_TYPE),
  data: joinRequestedPayloadSchema,
});
export type JoinRequestedEvent = z.infer<typeof joinRequestedEventSchema>;

export const joinApprovedEventSchema = EventSchema.extend({
  type: z.literal(JOIN_APPROVED_EVENT_TYPE),
  data: joinApprovedPayloadSchema,
});
export type JoinApprovedEvent = z.infer<typeof joinApprovedEventSchema>;

export const joinRejectedEventSchema = EventSchema.extend({
  type: z.literal(JOIN_REJECTED_EVENT_TYPE),
  data: joinRejectedPayloadSchema,
});
export type JoinRejectedEvent = z.infer<typeof joinRejectedEventSchema>;

export const joinExpiredEventSchema = EventSchema.extend({
  type: z.literal(JOIN_EXPIRED_EVENT_TYPE),
  data: joinExpiredPayloadSchema,
});
export type JoinExpiredEvent = z.infer<typeof joinExpiredEventSchema>;

export const joinWithdrawnEventSchema = EventSchema.extend({
  type: z.literal(JOIN_WITHDRAWN_EVENT_TYPE),
  data: joinWithdrawnPayloadSchema,
});
export type JoinWithdrawnEvent = z.infer<typeof joinWithdrawnEventSchema>;

export const joinRequestEventSchema = z.discriminatedUnion("type", [
  joinRequestedEventSchema,
  joinApprovedEventSchema,
  joinRejectedEventSchema,
  joinExpiredEventSchema,
  joinWithdrawnEventSchema,
]);
export type JoinRequestEvent = z.infer<typeof joinRequestEventSchema>;
