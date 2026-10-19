/**
 * The one-time reveal: a secret parked under an id and served exactly once,
 * so the ID can travel where the value must not.
 * Spec: modules/secret/specs/one-time-reveal.feature.
 */

import type { Named } from "@langwatch/module";
import { z } from "zod";

/** The prefix a reveal id carries, so an id in a log is legible as one. */
export const ONE_TIME_REVEAL_KSUID_RESOURCE = "rvl";

/** How long a reveal waits to be read, and how long its marker outlives it. */
export const ONE_TIME_REVEAL_TTL_MS = 24 * 60 * 60 * 1000;

/** What kind of secret a reveal holds. One entry today; the card that renders
 *  a reveal reads it, so a new kind is a new render, never a silent default. */
export const ONE_TIME_REVEAL_KINDS = ["virtual_key"] as const;
export const oneTimeRevealKindSchema = z.enum(ONE_TIME_REVEAL_KINDS);
export type OneTimeRevealKind = z.infer<typeof oneTimeRevealKindSchema>;

const stashRevealInputSchemaDefinition = z
  .object({
    organizationId: z.string().min(1),
    kind: oneTimeRevealKindSchema,
    /** The row the secret belongs to, for the log line and the card. */
    keyId: z.string().min(1),
    /** What a masked render shows in place of the secret, never the secret. */
    preview: z.string(),
    secret: z.string().min(1),
    /** The only person the reveal is served to; anyone else is told it expired. */
    recipientUserId: z.string().min(1),
  })
  .strict();
export interface StashRevealInputSchema extends Named<typeof stashRevealInputSchemaDefinition> {}
export const stashRevealInputSchema: StashRevealInputSchema = stashRevealInputSchemaDefinition;
export type StashRevealInput = z.infer<typeof stashRevealInputSchema>;

const revealOnceInputSchemaDefinition = z
  .object({ organizationId: z.string().min(1), revealId: z.string().min(1) })
  .strict();
export interface RevealOnceInputSchema extends Named<typeof revealOnceInputSchemaDefinition> {}
export const revealOnceInputSchema: RevealOnceInputSchema = revealOnceInputSchemaDefinition;
export type RevealOnceInput = z.infer<typeof revealOnceInputSchema>;

const stashedRevealSchemaDefinition = z.object({ revealId: z.string().min(1) }).strict();
export interface StashedRevealSchema extends Named<typeof stashedRevealSchemaDefinition> {}
export const stashedRevealSchema: StashedRevealSchema = stashedRevealSchemaDefinition;
export type StashedReveal = z.infer<typeof stashedRevealSchema>;

const revealedSecretSchemaDefinition = z
  .object({
    kind: oneTimeRevealKindSchema,
    keyId: z.string().min(1),
    preview: z.string(),
    secret: z.string().min(1),
  })
  .strict();
export interface RevealedSecretSchema extends Named<typeof revealedSecretSchemaDefinition> {}
export const revealedSecretSchema: RevealedSecretSchema = revealedSecretSchemaDefinition;
export type RevealedSecret = z.infer<typeof revealedSecretSchema>;
