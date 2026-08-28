import { z } from "zod";

/**
 * The transport inputs the join-request surface publishes.
 *
 * Every one of them is deliberately narrow. `lookup` takes no input at all —
 * it answers about the caller's own verified addresses — and `request` takes
 * only the organization it re-derives server-side, so there is no field a
 * caller can vary to probe for other people's organizations.
 *
 * The joining SETTING's input is not here: its `domainJoin` values are
 * `DOMAIN_JOIN_SETTINGS`, which the identity package owns, and a portable
 * contract restating them would be a second source of truth for the same
 * three words.
 */

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
