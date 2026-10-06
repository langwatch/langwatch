import { z } from "zod";

/** Transport inputs: deliberately narrow to prevent probing for other organizations. */

/** The organization an admin-side call is about. */
export const joinRequestApiOrganizationScopeSchema = z.object({
  organizationId: z.string().min(1),
});
export type JoinRequestApiOrganizationScope = z.infer<typeof joinRequestApiOrganizationScopeSchema>;

/** The organization being asked to let the caller in. */
/**
 * Where a request is made (ADR-171 v6), as the browser asserts it. Trusted
 * because it only LOWERS the seat; an older client naming nothing is `web`.
 */
export const joinRequestApiOriginSchema = z.enum(["web", "cli"]).default("web");
export type JoinRequestApiOrigin = z.infer<typeof joinRequestApiOriginSchema>;

export const joinRequestApiRequestInputSchema = z.object({
  organizationId: z.string().min(1),
  origin: joinRequestApiOriginSchema,
});

export const joinRequestApiAdmitInputSchema = z.object({
  origin: joinRequestApiOriginSchema,
});
export type JoinRequestApiRequestInput = z.infer<typeof joinRequestApiRequestInputSchema>;

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
