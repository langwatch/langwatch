/**
 * What a signed-out visitor may send the front door. Every one of these
 * crosses the network before anybody has an account, so the bounds are part
 * of the contract rather than a defensive afterthought.
 */
import { z } from "zod";

/**
 * The address a routing decision is asked about, null before anything is
 * typed, and the break-glass flag. Bounded at the RFC 5321 ceiling: anything
 * past 254 is not an address, so nothing carries it into normalization.
 */
export const frontDoorRouteInputSchema = z.object({
  identifier: z.string().max(254).nullable(),
  /** `?local=1`: the local method set, whatever else would route. */
  breakGlass: z.boolean().optional(),
});
export type FrontDoorRouteInput = z.infer<typeof frontDoorRouteInputSchema>;

/** The address a sign-up confirmation link is asked for. */
export const frontDoorEmailInputSchema = z.object({ email: z.string().email() });
export type FrontDoorEmailInput = z.infer<typeof frontDoorEmailInputSchema>;

/**
 * The caller's own address, taken from the session rather than the request, so
 * the body carries nothing at all.
 */
export const frontDoorOwnAddressInputSchema = z.object({});
export type FrontDoorOwnAddressInput = z.infer<typeof frontDoorOwnAddressInputSchema>;

/** The emailed confirmation token a visitor is spending. */
export const frontDoorTokenInputSchema = z.object({ token: z.string().min(1) });
export type FrontDoorTokenInput = z.infer<typeof frontDoorTokenInputSchema>;

/** The invitation code whose landing page is being read, or reissued. */
export const frontDoorInviteCodeInputSchema = z.object({ inviteCode: z.string().min(1) });
export type FrontDoorInviteCodeInput = z.infer<typeof frontDoorInviteCodeInputSchema>;
