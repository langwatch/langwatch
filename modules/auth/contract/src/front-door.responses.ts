/**
 * Schemas for signed-out front door responses. Deliberately small for
 * unauthenticated users; routing decisions live in identity's routingDecisionSchema.
 */
import { SIGNIN_ROUTING_REASON_CODES, signInMethodSchema } from "@langwatch/identity-contract";
import type { Named } from "@langwatch/module";
import { z } from "zod";

/**
 * A sign-up link was asked for. Where this installation cannot send email nothing is sent,
 * and the answer carries the unconfirmed proof a password sign-up spends instead.
 */
const signUpVerificationRequestSchemaDefinition = z.discriminatedUnion("sent", [
  z.object({ sent: z.literal(true) }).strict(),
  z.object({ sent: z.literal(false), addressProof: z.string() }).strict(),
]);
export interface SignUpVerificationRequestSchema extends Named<
  typeof signUpVerificationRequestSchemaDefinition
> {}
export const signUpVerificationRequestSchema: SignUpVerificationRequestSchema =
  signUpVerificationRequestSchemaDefinition;
export type SignUpVerificationRequest = z.infer<typeof signUpVerificationRequestSchema>;

/** The own-address link went out; names the identifier its verifier is filed under. */
const frontDoorOwnAddressSentSchemaDefinition = z
  .object({ sent: z.literal(true), identifierId: z.string() })
  .strict();
export interface FrontDoorOwnAddressSentSchema extends Named<
  typeof frontDoorOwnAddressSentSchemaDefinition
> {}
export const frontDoorOwnAddressSentSchema: FrontDoorOwnAddressSentSchema =
  frontDoorOwnAddressSentSchemaDefinition;
export type FrontDoorOwnAddressSent = z.infer<typeof frontDoorOwnAddressSentSchema>;

/** The admins were told somebody is waiting. Never says how many, or who. */
const frontDoorAskedSchemaDefinition = z.object({ asked: z.boolean() }).strict();
export interface FrontDoorAskedSchema extends Named<typeof frontDoorAskedSchemaDefinition> {}
export const frontDoorAskedSchema: FrontDoorAskedSchema = frontDoorAskedSchemaDefinition;
export type FrontDoorAsked = z.infer<typeof frontDoorAskedSchema>;

/**
 * `POST /api/auth/sign-up/confirm-address`: the address a spent link confirmed, whether
 * an account stands behind it, the single-use proof `auth.register` spends where none
 * does, and whether this spend opened a session.
 */
const signUpVerificationResultSchemaDefinition = z
  .object({
    email: z.string(),
    accountCreated: z.boolean(),
    accountExists: z.boolean(),
    addressProof: z.string().nullable(),
    signedIn: z.boolean(),
  })
  .strict();
export interface SignUpVerificationResultSchema extends Named<
  typeof signUpVerificationResultSchemaDefinition
> {}
export const signUpVerificationResultSchema: SignUpVerificationResultSchema =
  signUpVerificationResultSchemaDefinition;
export type SignUpVerificationResult = z.infer<typeof signUpVerificationResultSchema>;

/**
 * The caller's own address and whether it is confirmed; null where the session carries none.
 * `canSendConfirmation` is false where this installation has no way to send email.
 */
const addressConfirmationSchemaDefinition = z
  .object({
    email: z.string().nullable(),
    confirmed: z.boolean(),
    canSendConfirmation: z.boolean(),
  })
  .strict();
export interface AddressConfirmationSchema extends Named<
  typeof addressConfirmationSchemaDefinition
> {}
export const addressConfirmationSchema: AddressConfirmationSchema =
  addressConfirmationSchemaDefinition;
export type AddressConfirmation = z.infer<typeof addressConfirmationSchema>;

/** Why a signed-out visitor is here: only an expired session of theirs names its address. */
const priorSessionSchemaDefinition = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("expired"), email: z.string() }).strict(),
  z.object({ kind: z.literal("unknown") }).strict(),
]);
export interface PriorSessionSchema extends Named<typeof priorSessionSchemaDefinition> {}
export const priorSessionSchema: PriorSessionSchema = priorSessionSchemaDefinition;

export type PriorSession = z.infer<typeof priorSessionSchema>;

export const SIGN_UP_ENROLLMENT_OUTCOMES = [
  "enroll",
  "redirect",
  "existing_account",
  "unavailable",
] as const;

/** What a proven address may enrol: the methods on offer, or why it goes elsewhere. */
const signUpEnrollmentSchemaDefinition = z
  .object({
    outcome: z.enum(SIGN_UP_ENROLLMENT_OUTCOMES),
    methodSet: z.array(signInMethodSchema).readonly(),
    reasonCode: z.enum(SIGNIN_ROUTING_REASON_CODES),
  })
  .strict();
export interface SignUpEnrollmentSchema extends Named<typeof signUpEnrollmentSchemaDefinition> {}
export const signUpEnrollmentSchema: SignUpEnrollmentSchema = signUpEnrollmentSchemaDefinition;
export type SignUpEnrollment = z.infer<typeof signUpEnrollmentSchema>;
