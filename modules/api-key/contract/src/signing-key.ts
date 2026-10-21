/**
 * A project's braid signing keys (ADR-183 §4): the list item the keys screen reads, the answer
 * that carries a secret once, and what verification answers the trace module. No schema here
 * holds a secret except `issuedSigningKeySchema`, which only create and rotate answer.
 */
import type { Named } from "@langwatch/module";
import { z } from "zod";

/** The old key keeps verifying this long after a rotation (ADR-183, Constants). */
export const SIGNING_KEY_ROTATION_OVERLAP_MS = 7 * 24 * 60 * 60 * 1000;
/** The longest a decrypted key, or its absence, is held in one process (ADR-183 §4, record §7). */
export const SIGNING_KEY_LOOKUP_CACHE_MS = 60_000;

export const SIGNING_KEY_STATUSES = ["active", "verifying", "revoked"] as const;
export const signingKeyStatusSchema = z.enum(SIGNING_KEY_STATUSES);
export type SigningKeyStatus = z.infer<typeof signingKeyStatusSchema>;

const signingKeySchemaDefinition = z.object({
  id: z.string(),
  name: z.string(),
  publicId: z.string(),
  projectId: z.string(),
  status: signingKeyStatusSchema,
  createdAt: z.date(),
  createdByUserId: z.string(),
  lastUsedAt: z.date().nullable(),
  verifiesUntil: z.date().nullable(),
  revokedAt: z.date().nullable(),
  /** Signed spans whose signature passed in the last 24 hours. */
  passed24h: z.number().int().nonnegative(),
  /** Signed spans whose signature failed in the last 24 hours. */
  failed24h: z.number().int().nonnegative(),
});
export interface SigningKeySchema extends Named<typeof signingKeySchemaDefinition> {}
export const signingKeySchema: SigningKeySchema = signingKeySchemaDefinition;
/** One signing key as listed; never its secret. */
export type SigningKey = z.infer<typeof signingKeySchema>;

const issuedSigningKeySchemaDefinition = z.object({
  signingKey: signingKeySchema,
  /** The whole key, `lwsk_<publicId>_<secret>`, answered once by create or rotate. */
  secret: z.string(),
});
export interface IssuedSigningKeySchema extends Named<typeof issuedSigningKeySchemaDefinition> {}
export const issuedSigningKeySchema: IssuedSigningKeySchema = issuedSigningKeySchemaDefinition;
export type IssuedSigningKey = z.infer<typeof issuedSigningKeySchema>;

const signingKeyProjectInputSchemaDefinition = z.object({ projectId: z.string() });
export interface SigningKeyProjectInputSchema extends Named<
  typeof signingKeyProjectInputSchemaDefinition
> {}
export const signingKeyProjectInputSchema: SigningKeyProjectInputSchema =
  signingKeyProjectInputSchemaDefinition;

const createSigningKeyInputSchemaDefinition = z.object({
  projectId: z.string(),
  name: z.string().trim().min(1).max(100),
});
export interface CreateSigningKeyInputSchema extends Named<
  typeof createSigningKeyInputSchemaDefinition
> {}
export const createSigningKeyInputSchema: CreateSigningKeyInputSchema =
  createSigningKeyInputSchemaDefinition;

const signingKeyActionInputSchemaDefinition = z.object({
  projectId: z.string(),
  keyId: z.string(),
});
export interface SigningKeyActionInputSchema extends Named<
  typeof signingKeyActionInputSchemaDefinition
> {}
export const signingKeyActionInputSchema: SigningKeyActionInputSchema =
  signingKeyActionInputSchemaDefinition;

/** Who acts on a project's signing keys: the creator of a new key is named on its row. */
export type SigningKeyCaller = Readonly<{ userId: string }>;
export type FindSigningKeysInput = z.infer<typeof signingKeyProjectInputSchema>;
export type CreateSigningKeyInput = z.infer<typeof createSigningKeyInputSchema> & SigningKeyCaller;
export type RotateSigningKeyInput = z.infer<typeof signingKeyActionInputSchema> & SigningKeyCaller;
export type RevokeSigningKeyInput = z.infer<typeof signingKeyActionInputSchema>;

export const BRAID_SIGNATURE_FAILURE_REASONS = [
  "malformed",
  "unknown_key",
  "revoked",
  "expired",
  "bad_signature",
] as const;
export const braidSignatureFailureReasonSchema = z.enum(BRAID_SIGNATURE_FAILURE_REASONS);
/** Why a signature failed; a key of another organisation reads as `unknown_key`. */
export type BraidSignatureFailureReason = z.infer<typeof braidSignatureFailureReasonSchema>;

const verifyBraidSignatureInputSchemaDefinition = z.object({
  /** The organisation of the project the span is admitted into; the key is looked up within it. */
  organizationId: z.string(),
  traceId: z.string(),
  /** The span's attributes for the entries the signature names; others are ignored. */
  entries: z.record(z.string(), z.string()),
  /** The `langwatch.signature` attribute as the span carries it. */
  signature: z.string(),
});
export interface VerifyBraidSignatureInputSchema extends Named<
  typeof verifyBraidSignatureInputSchemaDefinition
> {}
export const verifyBraidSignatureInputSchema: VerifyBraidSignatureInputSchema =
  verifyBraidSignatureInputSchemaDefinition;
export type VerifyBraidSignatureInput = z.infer<typeof verifyBraidSignatureInputSchema>;

const braidSignatureVerdictSchemaDefinition = z.discriminatedUnion("outcome", [
  z.object({
    outcome: z.literal("verified"),
    signingProjectId: z.string(),
    /** The entry keys the signature covers, each verified for this trace. */
    keys: z.array(z.string()),
  }),
  z.object({
    outcome: z.literal("failed"),
    reason: braidSignatureFailureReasonSchema,
    /** The public id the signature named, when it could be read. */
    publicId: z.string().optional(),
  }),
  z.object({ outcome: z.literal("unavailable") }),
]);
export interface BraidSignatureVerdictSchema extends Named<
  typeof braidSignatureVerdictSchemaDefinition
> {}
export const braidSignatureVerdictSchema: BraidSignatureVerdictSchema =
  braidSignatureVerdictSchemaDefinition;
/** What one signature check answers; `unavailable` leaves the span unverified, never refused. */
export type BraidSignatureVerdict = z.infer<typeof braidSignatureVerdictSchema>;
