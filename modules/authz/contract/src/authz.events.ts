import { z } from "zod";

export const AUTHZ_AGGREGATE_READ_EVENT_TYPE = "lw.authz.aggregate_read" as const;

/**
 * One user's read of an aggregate project through its shared grants (ADR-177 decision 9): who, in
 * which organization, of which aggregate, and when. Never the member read or the trace opened.
 */
export const authzAggregateReadEventDataSchema = z.object({
  tenantId: z.string().min(1),
  organizationId: z.string().min(1),
  actorUserId: z.string().min(1),
  aggregateProjectId: z.string().min(1),
  occurredAt: z.number().int().nonnegative(),
});
export type AuthzAggregateReadEventData = z.infer<typeof authzAggregateReadEventDataSchema>;

export const AUTHZ_MEMBER_OFFBOARDED_EVENT_TYPE = "lw.authz.member_offboarded" as const;

/**
 * A proven offboarding took one member's seat and every grant in an organization
 * (M8487-REMOVAL-OWNERS). Organization records its member_removed from this fact.
 */
export const authzMemberOffboardedEventDataSchema = z.object({
  tenantId: z.string().min(1),
  organizationId: z.string().min(1),
  userId: z.string().min(1),
  /** The person who offboarded them; null when a surface such as SCIM did. */
  offboardedByUserId: z.string().min(1).nullable(),
  occurredAt: z.number().int().nonnegative(),
});
export type AuthzMemberOffboardedEventData = z.infer<typeof authzMemberOffboardedEventDataSchema>;
