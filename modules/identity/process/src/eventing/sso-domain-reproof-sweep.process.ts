import type { IntentSpec, WakeHandler } from "@langwatch/eventing";
import { z } from "zod";

export const SSO_DOMAIN_REPROOF_SWEEP_PROCESS_NAME = "ssoDomainReproofSweep";

/** Three times a day (ADR-123): the forty-eight-hour grace spans six re-reads. */
export const SSO_DOMAIN_REPROOF_SWEEP_INTERVAL_MS = 8 * 60 * 60 * 1000;

export const ssoDomainReproofSweepSchema = z.object({
  scheduledFor: z.number().int(),
});

export interface SsoDomainReproofSweepState {
  lastSweepAt: number | null;
}

export const SSO_DOMAIN_REPROOF_SWEEP_INITIAL_STATE: SsoDomainReproofSweepState = {
  lastSweepAt: null,
};

export type SsoDomainReproofSweepIntents = {
  sweep: IntentSpec<typeof ssoDomainReproofSweepSchema>;
};

/**
 * Pure and synchronous: the commit persisting this evolution is what fences
 * racing workers. The re-read itself is an intent, run behind the outbox lease.
 */
export const ssoDomainReproofSweepWake: WakeHandler<
  SsoDomainReproofSweepState,
  SsoDomainReproofSweepIntents
> = (_state, ctx) => ({
  state: { lastSweepAt: ctx.at },
  intents: [ctx.intents.sweep(`sweep:${ctx.at}`, { scheduledFor: ctx.at })],
});
