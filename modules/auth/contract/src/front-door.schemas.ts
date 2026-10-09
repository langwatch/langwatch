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

/** Sign-up's address, plus where the screen goes once through: the emailed link carries it. */
export const signUpVerificationInputSchema = z.object({
  ...frontDoorEmailInputSchema.shape,
  callbackUrl: z.string().max(2048).optional(),
});

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

/** A redirect target longer than this is not a route on this site. */
const MAX_RETURN_TO_LENGTH = 2048;

/**
 * Whether a redirect target is a path on THIS site: one slash, then neither a slash nor a
 * backslash (browsers read `//host` and `/\host` as scheme-relative), no line break, tab or NUL.
 * Asked before a path is mailed, stored or followed, so a crafted query gets the same answer.
 */
export function isSafeReturnToPath(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0) return false;
  if (value.length > MAX_RETURN_TO_LENGTH || !value.startsWith("/")) return false;
  if (value.startsWith("//") || value.startsWith("/\\")) return false;
  return !/[\r\n\t\0]/.test(value);
}
