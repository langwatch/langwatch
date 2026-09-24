/**
 * The access-model reconvergence watch (ADR-159): after boot, while a config store owns the
 * LangWatchQL model, probe on a backoff from 5 s to 5 min for 30 min, and re-provision once
 * released. Pure; the probe and the convergence run behind the outbox lease.
 */
import type { IntentSpec, WakeHandler } from "@langwatch/eventing";
import { z } from "zod";

export const LWQL_RECONVERGENCE_INITIAL_DELAY_MS = 5_000;
export const LWQL_RECONVERGENCE_MAX_DELAY_MS = 5 * 60_000;
export const LWQL_RECONVERGENCE_BUDGET_MS = 30 * 60_000;

export const lwqlReconvergenceSchema = z.object({
  scheduledFor: z.number().int(),
  /** The last probe the budget allows; a model still config-owned then is given up on. */
  final: z.boolean(),
});

export interface LwqlReconvergenceState {
  /** The boot this schedule belongs to; a new boot starts a fresh watch. */
  bootedAt: number | null;
  /** Epoch ms of the next probe. */
  nextAt: number;
  delayMs: number;
  elapsedMs: number;
  gaveUp: boolean;
}

export const LWQL_RECONVERGENCE_INITIAL_STATE: LwqlReconvergenceState = {
  bootedAt: null,
  nextAt: 0,
  delayMs: LWQL_RECONVERGENCE_INITIAL_DELAY_MS,
  elapsedMs: 0,
  gaveUp: false,
};

export type LwqlReconvergenceIntents = {
  reconverge: IntentSpec<typeof lwqlReconvergenceSchema>;
};

function freshWatch(bootedAt: number): LwqlReconvergenceState {
  return {
    bootedAt,
    nextAt: bootedAt + LWQL_RECONVERGENCE_INITIAL_DELAY_MS,
    delayMs: LWQL_RECONVERGENCE_INITIAL_DELAY_MS,
    elapsedMs: 0,
    gaveUp: false,
  };
}

/** Probes when due, doubling the delay up to the cap, and stops once the budget would overrun. */
export function lwqlReconvergenceWake({
  bootedAt,
}: {
  bootedAt: number;
}): WakeHandler<LwqlReconvergenceState, LwqlReconvergenceIntents> {
  return (state, ctx) => {
    const at = Math.max(ctx.at, ctx.now);
    const watch = state.bootedAt === bootedAt ? state : freshWatch(bootedAt);
    if (watch.gaveUp || at < watch.nextAt) return { state: watch };
    const elapsedMs = watch.elapsedMs + watch.delayMs;
    const delayMs = Math.min(watch.delayMs * 2, LWQL_RECONVERGENCE_MAX_DELAY_MS);
    const gaveUp = elapsedMs + delayMs > LWQL_RECONVERGENCE_BUDGET_MS;
    return {
      state: { bootedAt, nextAt: at + delayMs, delayMs, elapsedMs, gaveUp },
      intents: [
        ctx.intents.reconverge(`reconverge:${bootedAt}:${elapsedMs}`, {
          scheduledFor: at,
          final: gaveUp,
        }),
      ],
    };
  };
}
