/**
 * Schemas for signed-out front door responses. Deliberately small for
 * unauthenticated users; routing decisions live in identity's routingDecisionSchema.
 */
import { SIGNIN_ROUTING_REASON_CODES, signInMethodSchema } from "@langwatch/identity-contract";
import { z } from "zod";

/** A mail was asked for. The same answer whether or not one was needed. */
export const frontDoorSentSchema = z.object({ sent: z.literal(true) }).strict();
export type FrontDoorSent = z.infer<typeof frontDoorSentSchema>;

/** The admins were told somebody is waiting. Never says how many, or who. */
export const frontDoorAskedSchema = z.object({ asked: z.boolean() }).strict();
export type FrontDoorAsked = z.infer<typeof frontDoorAskedSchema>;

/**
 * What a spent confirmation link resolved to: the address it confirmed, whether
 * spending it brought the account into being, and — only where no account stands
 * behind the address — the single-use proof `user.register` spends.
 */
export const signUpVerificationResultSchema = z
  .object({
    email: z.string(),
    accountCreated: z.boolean(),
    accountExists: z.boolean(),
    addressProof: z.string().nullable(),
  })
  .strict();
export type SignUpVerificationResult = z.infer<typeof signUpVerificationResultSchema>;

/**
 * What an invitation link may say to whoever opens it: which organization is
 * asking, and who asked — enough to decide, but nothing that makes a guessed
 * code worth guessing (no address, no role, no membership).
 */
export const inviteLandingSchema = z
  .object({
    organizationName: z.string(),
    inviterName: z.string().nullable(),
    alreadyAccepted: z.boolean(),
  })
  .strict();
export type InviteLanding = z.infer<typeof inviteLandingSchema>;

/** The caller's own address and whether it is confirmed; null where the session carries none. */
export const addressConfirmationSchema = z
  .object({ email: z.string().nullable(), confirmed: z.boolean() })
  .strict();
export type AddressConfirmation = z.infer<typeof addressConfirmationSchema>;

/** Why a signed-out visitor is here: only an expired session of theirs names its address. */
export const priorSessionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("expired"), email: z.string() }).strict(),
  z.object({ kind: z.literal("unknown") }).strict(),
]);

export type PriorSession = z.infer<typeof priorSessionSchema>;

export const SIGN_UP_ENROLLMENT_OUTCOMES = [
  "enroll",
  "redirect",
  "existing_account",
  "unavailable",
] as const;

/** What a proven address may enrol: the methods on offer, or why it goes elsewhere. */
export const signUpEnrollmentSchema = z
  .object({
    outcome: z.enum(SIGN_UP_ENROLLMENT_OUTCOMES),
    methodSet: z.array(signInMethodSchema).readonly(),
    reasonCode: z.enum(SIGNIN_ROUTING_REASON_CODES),
  })
  .strict();
export type SignUpEnrollment = z.infer<typeof signUpEnrollmentSchema>;
