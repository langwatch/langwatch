/**
 * What a signed-out visitor may send the front door. Every one of these
 * crosses the network before anybody has an account, so the bounds are part
 * of the contract rather than a defensive afterthought.
 */
import { identifierCodeChallengeSchema } from "@langwatch/identity-contract";
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
 * The caller's own address comes from the session, never the request; the body
 * carries only the S256 challenge whose verifier the asking window keeps.
 */
export const frontDoorOwnAddressInputSchema = z.object({
  codeChallenge: identifierCodeChallengeSchema,
});
export type FrontDoorOwnAddressInput = z.infer<typeof frontDoorOwnAddressInputSchema>;

/** The emailed confirmation token a visitor is spending. */
export const frontDoorTokenInputSchema = z.object({ token: z.string().min(1) });
export type FrontDoorTokenInput = z.infer<typeof frontDoorTokenInputSchema>;

/** The invitation code whose landing page is being read, or reissued. */
export const frontDoorInviteCodeInputSchema = z.object({ inviteCode: z.string().min(1) });
export type FrontDoorInviteCodeInput = z.infer<typeof frontDoorInviteCodeInputSchema>;

/** A confirmed address and the proof its spent link minted, asking what it may enrol. */
export const signUpEnrollmentInputSchema = z.object({
  email: z.string().email(),
  addressProof: z.string().min(1),
});
export type SignUpEnrollmentInput = z.infer<typeof signUpEnrollmentInputSchema>;
