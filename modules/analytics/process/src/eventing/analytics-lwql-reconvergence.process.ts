/**
 * The LangWatchQL reconvergence check (ADR-159): every 5 minutes, with no end, one check across
 * the fleet reads what the app-owned objects lack and converges only then. Pure; the check runs
 * behind the outbox lease on whichever worker holds it, so nothing here is per process.
 */
import type { IntentSpec, WakeHandler } from "@langwatch/eventing";
import { z } from "zod";

export const LWQL_RECONVERGENCE_INTERVAL_MS = 5 * 60_000;
/** A safety net under the project-created subscriber: a fill reads every project. */
export const LWQL_KEY_MAP_REFILL_MS = 24 * 60 * 60_000;

export const lwqlReconvergenceSchema = z.object({
  scheduledFor: z.number().int(),
  /** The first check, and the first a day after the last fill, fill missing key-map rows. */
  fillKeyMap: z.boolean().default(false),
});

/** Defaulted, so a row the earlier boot-scoped watch stored still parses. */
export const lwqlReconvergenceStateSchema = z.object({
  /** Epoch ms of the last check that asked for a key-map fill; null before the first. */
  keyMapFillAskedAt: z.number().nullable().default(null),
});
export type LwqlReconvergenceState = z.infer<typeof lwqlReconvergenceStateSchema>;

export const LWQL_RECONVERGENCE_INITIAL_STATE: LwqlReconvergenceState = {
  keyMapFillAskedAt: null,
};

type LwqlReconvergenceIntents = {
  reconverge: IntentSpec<typeof lwqlReconvergenceSchema>;
};

/** Every wake asks for one check, keyed by its slot so two workers' copies of a wake dedupe. */
export const lwqlReconvergenceWake: WakeHandler<
  LwqlReconvergenceState,
  LwqlReconvergenceIntents
> = (state, ctx) => {
  const fillKeyMap =
    state.keyMapFillAskedAt === null || ctx.at - state.keyMapFillAskedAt >= LWQL_KEY_MAP_REFILL_MS;
  return {
    state: { keyMapFillAskedAt: fillKeyMap ? ctx.at : state.keyMapFillAskedAt },
    intents: [
      ctx.intent("reconverge", `reconverge:${ctx.at}`, { scheduledFor: ctx.at, fillKeyMap }),
    ],
  };
};
