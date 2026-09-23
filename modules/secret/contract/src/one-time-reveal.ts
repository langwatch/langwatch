/**
 * The one-time reveal: a secret parked under an id and served exactly once,
 * so the ID can travel where the value must not.
 * Spec: modules/secret/specs/one-time-reveal.feature.
 */

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

export const stashRevealInputSchema = z
  .object({
    organizationId: z.string().min(1),
    kind: oneTimeRevealKindSchema,
    /** The row the secret belongs to, for the log line and the card. */
    keyId: z.string().min(1),
    /** What a masked render shows in place of the secret, never the secret. */
    preview: z.string(),
    secret: z.string().min(1),
  })
  .strict();
export type StashRevealInput = z.infer<typeof stashRevealInputSchema>;

export const revealOnceInputSchema = z
  .object({ organizationId: z.string().min(1), revealId: z.string().min(1) })
  .strict();
export type RevealOnceInput = z.infer<typeof revealOnceInputSchema>;

export const stashedRevealSchema = z.object({ revealId: z.string().min(1) }).strict();
export type StashedReveal = z.infer<typeof stashedRevealSchema>;

export const revealedSecretSchema = z
  .object({
    kind: oneTimeRevealKindSchema,
    keyId: z.string().min(1),
    preview: z.string(),
    secret: z.string().min(1),
  })
  .strict();
export type RevealedSecret = z.infer<typeof revealedSecretSchema>;
