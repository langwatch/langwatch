import type { EventHandler, IntentSpec, WakeHandler } from "@langwatch/eventing";
import { z } from "zod";

import { platformOperatorSeedRecordedEventDataSchema } from "./ops-platform-operator-seed.events.ts";

export const PLATFORM_OPERATOR_SEED_PROCESS_NAME = "platformOperatorSeed" as const;

/** The tenant of the scheduled singleton instance the wake runs on (eventing's processRuntime). */
export const PLATFORM_OPERATOR_SEED_TENANT_ID = "__global__" as const;

/** A minute: after an upgrade, or a fresh install's first sign-up, the seed waits at most this. */
export const PLATFORM_OPERATOR_SEED_WAKE_INTERVAL_MS = 60 * 1000;

/**
 * The durable marker, set only by the seed's own recorded event: never by a wake, never because
 * the holder list is empty (review F2b), and never while the seed is still waiting.
 */
export const platformOperatorSeedStateSchema = z.object({
  seededAt: z.number().nullable(),
});
export type PlatformOperatorSeedState = z.infer<typeof platformOperatorSeedStateSchema>;

export const platformOperatorSeedIntentSchema = z.object({ requestedAt: z.number().int() });

/** The grant intent carries the recorded decision itself: only that decision is ever granted. */
export const platformOperatorSeedGrantIntentSchema = platformOperatorSeedRecordedEventDataSchema;

/** One key: the outbox holds one grant for the one recorded decision. */
export const PLATFORM_OPERATOR_SEED_GRANT_KEY = "grant:recorded" as const;

export type PlatformOperatorSeedIntents = {
  seed: IntentSpec<typeof platformOperatorSeedIntentSchema>;
  grant: IntentSpec<typeof platformOperatorSeedGrantIntentSchema>;
};

/** Until the marker is set, every wake asks for one attempt, keyed by that wake. */
export const platformOperatorSeedWake: WakeHandler<
  PlatformOperatorSeedState,
  PlatformOperatorSeedIntents
> = (state, ctx) => {
  if (state.seededAt !== null) return { state };
  return {
    state,
    intents: [ctx.intent("seed", `seed:${ctx.at}`, { requestedAt: ctx.at })],
  };
};

/**
 * The seed decided: latch, and grant what the decision names. The grant runs from here, never
 * from the attempt, so a record that failed granted nobody and a second record (or redelivery)
 * finds the marker set and grants nothing (review L2).
 */
export const platformOperatorSeedRecorded: EventHandler<
  PlatformOperatorSeedState,
  z.infer<typeof platformOperatorSeedRecordedEventDataSchema>,
  PlatformOperatorSeedIntents
> = (state, decision, ctx) => {
  if (state.seededAt !== null) return { state };
  return {
    state: { seededAt: ctx.at },
    intents:
      decision.userIds.length > 0
        ? [ctx.intent("grant", PLATFORM_OPERATOR_SEED_GRANT_KEY, decision)]
        : [],
  };
};
