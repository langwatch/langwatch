import { z } from "zod";

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
