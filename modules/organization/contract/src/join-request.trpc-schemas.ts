import { z } from "zod";

/** Transport inputs: deliberately narrow to prevent probing for other organizations. */

/** The organization an admin-side call is about. */
export const joinRequestApiOrganizationScopeSchema = z.object({
  organizationId: z.string().min(1),
});
export type JoinRequestApiOrganizationScope = z.infer<typeof joinRequestApiOrganizationScopeSchema>;

/** The organization being asked to let the caller in. */
export const joinRequestApiRequestInputSchema = z.object({
  organizationId: z.string().min(1),
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
