import type { Named } from "@langwatch/module";
/**
 * Langy's onboarding facts: a failed turn of the organization's guided conversation, and a
 * person's first answer from Langy.
 * Peers react from their side (§9); langy sends no analytics itself.
 * @see specs/analytics/posthog-guided-onboarding.feature
 */
import { guidedPathSchema, onboardingVariantSchema } from "@langwatch/onboarding-contract";
import { z } from "zod";

export const LANGY_GUIDED_ONBOARDING_PIPELINE_NAME = "langy_guided_onboarding" as const;
export const LANGY_GUIDED_ONBOARDING_AGGREGATE_TYPE = "langy_guided_onboarding" as const;
export const GUIDED_ONBOARDING_TURN_FAILED_EVENT_TYPE =
  "lw.langy_guided_onboarding.turn_failed" as const;
export const GUIDED_ONBOARDING_TURN_FAILED_EVENT_VERSION = "2026-10-06" as const;

/** A failed turn of the guided conversation, attributed to the conversation's owner. */
const guidedOnboardingTurnFailedEventDataSchemaDefinition = z.object({
  /** The project the conversation lives in. */
  tenantId: z.string().min(1),
  occurredAt: z.number().int().nonnegative(),
  /** The conversation event that ended the turn: one fact per source event. */
  sourceEventId: z.string().min(1),
  organizationId: z.string().min(1),
  userId: z.string().min(1),
  conversationId: z.string().min(1),
  turnId: z.string().min(1),
  /** The handled error's code, `unknown` when the relay wrote none. */
  code: z.string().min(1),
  path: guidedPathSchema.nullable(),
  /** Absent for an organization older than the experiment, or self-hosted. */
  onboardingVariant: onboardingVariantSchema.nullish(),
});
export interface GuidedOnboardingTurnFailedEventDataSchema extends Named<
  typeof guidedOnboardingTurnFailedEventDataSchemaDefinition
> {}
export const guidedOnboardingTurnFailedEventDataSchema: GuidedOnboardingTurnFailedEventDataSchema =
  guidedOnboardingTurnFailedEventDataSchemaDefinition;
export type GuidedOnboardingTurnFailedEventData = z.infer<
  typeof guidedOnboardingTurnFailedEventDataSchema
>;

/**
 * The first time Langy completed an answer in a conversation the user owns: the user got Langy's
 * first message. One fact per user (the idempotency key names only the user); ids only.
 */
export const LANGY_FIRST_MESSAGE_SEEN_EVENT_TYPE =
  "lw.langy_guided_onboarding.first_message_seen" as const;
export const LANGY_FIRST_MESSAGE_SEEN_EVENT_VERSION = "2026-11-10" as const;

const langyFirstMessageSeenEventDataSchemaDefinition = z.object({
  /** The project the conversation lives in. */
  tenantId: z.string().min(1),
  occurredAt: z.number().int().nonnegative(),
  /** The conversation's owner: the person who got the answer. */
  userId: z.string().min(1),
  conversationId: z.string().min(1),
});
export interface LangyFirstMessageSeenEventDataSchema extends Named<
  typeof langyFirstMessageSeenEventDataSchemaDefinition
> {}
export const langyFirstMessageSeenEventDataSchema: LangyFirstMessageSeenEventDataSchema =
  langyFirstMessageSeenEventDataSchemaDefinition;
export type LangyFirstMessageSeenEventData = z.infer<typeof langyFirstMessageSeenEventDataSchema>;
