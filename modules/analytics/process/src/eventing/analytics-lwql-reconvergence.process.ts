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

const KEY_MAP_FILL_RETRY_CAP_MS = 2 * 60 * 60_000;
/** Deliveries of a check whose fill keeps failing; the last lands 22.6 hours after the first. */
export const LWQL_KEY_MAP_FILL_MAX_ATTEMPTS = 16;

/** 5 minutes, doubling, capped at 2 hours: each retried fill reads every project. */
export function lwqlKeyMapFillRetryDelayMs({ attempt }: { attempt: number }): number {
  return Math.min(LWQL_RECONVERGENCE_INTERVAL_MS * 2 ** (attempt - 1), KEY_MAP_FILL_RETRY_CAP_MS);
}

export const lwqlReconvergenceSchema = z.object({
  scheduledFor: z.number().int(),
  /** The first check, and the first a day after the last ask, fill missing key-map rows. */
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

/**
 * Every wake asks for one check, keyed by its slot so two workers' copies of a wake dedupe. The
 * mark moves when a check is asked to fill: a failed fill throws, and the outbox delivers that
 * check again, backing off to every 2 hours, until the fill succeeds or the chain ends in a day.
 */
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
