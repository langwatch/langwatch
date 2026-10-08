import { z } from "zod";

import { DOMAIN_JOIN_SETTINGS } from "./join-matching.ts";
import { joinerRoleSchema } from "./join-request.responses.ts";
import { joinRequestOriginSchema } from "./join-request.ts";

/** Transport inputs: deliberately narrow to prevent probing for other organizations. */

/** The organization an admin-side call is about. */
export const joinRequestApiOrganizationScopeSchema = z.object({
  organizationId: z.string().min(1),
});
export type JoinRequestApiOrganizationScope = z.infer<typeof joinRequestApiOrganizationScopeSchema>;

/**
 * Where a request is made (ADR-171 v6), as the browser asserts it. Trusted
 * because it only LOWERS the seat; an older client naming nothing is `web`.
 */
export const joinRequestApiOriginSchema = joinRequestOriginSchema.default("web");
export type JoinRequestApiOrigin = z.infer<typeof joinRequestApiOriginSchema>;

/** The organization being asked to let the caller in. */
export const joinRequestApiRequestInputSchema = z.object({
  organizationId: z.string().min(1),
  origin: joinRequestApiOriginSchema,
});
export type JoinRequestApiRequestInput = z.infer<typeof joinRequestApiRequestInputSchema>;

export const joinRequestApiAdmitInputSchema = z.object({
  origin: joinRequestApiOriginSchema,
});

export const joinRequestApiWithdrawInputSchema = z.object({
  joinRequestId: z.string().min(1),
});
export type JoinRequestApiWithdrawInput = z.infer<typeof joinRequestApiWithdrawInputSchema>;

/** One waiting request an admin is approving or rejecting. */
export const joinRequestApiDecisionInputSchema = z.object({
  organizationId: z.string().min(1),
  joinRequestId: z.string().min(1),
});
export type JoinRequestApiDecisionInput = z.infer<typeof joinRequestApiDecisionInputSchema>;

/** How colleagues on a matching domain get in, as an administrator saves it. */
export const joinRequestApiSetJoiningInputSchema = z.object({
  organizationId: z.string().min(1),
  domainJoin: z.enum(DOMAIN_JOIN_SETTINGS),
  domains: z.array(z.string().min(1)).default([]),
  joinerRole: joinerRoleSchema.optional(),
});
export type JoinRequestApiSetJoiningInput = z.infer<typeof joinRequestApiSetJoiningInputSchema>;

/** The members whose provenance the members area is showing; the answer covers no one else. */
export const joinRequestApiAdmissionsInputSchema = z.object({
  organizationId: z.string().min(1),
  userIds: z.array(z.string().min(1)),
});
export type JoinRequestApiAdmissionsInput = z.infer<typeof joinRequestApiAdmissionsInputSchema>;
