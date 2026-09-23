// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type { IntentSpec, WakeHandler } from "@langwatch/eventing";
import { z } from "zod";

/** The connected billing tick runs once a day; nothing on it is urgent to the minute. */
export const CONNECTED_BILLING_TICK_INTERVAL_MS = 24 * 60 * 60 * 1000;

/** The first tick waits for the process to finish coming up. */
export const CONNECTED_BILLING_FIRST_DELAY_MS = 5 * 60 * 1000;

export const connectedBillingTickSchema = z.object({ scheduledFor: z.number().int() });

export interface ConnectedBillingTickState {
  /** Epoch ms of the last tick this process asked for. */
  lastTickAt: number | null;
}

export const CONNECTED_BILLING_INITIAL_STATE: ConnectedBillingTickState = { lastTickAt: null };

export type ConnectedBillingTickIntents = {
  tick: IntentSpec<typeof connectedBillingTickSchema>;
};

/**
 * Due once the process has been up for the first delay and has not ticked
 * since it came up, and then a day after each tick. Pure; the tick itself
 * runs behind the outbox lease.
 */
export function connectedBillingWake({
  bootedAt,
}: {
  bootedAt: number;
}): WakeHandler<ConnectedBillingTickState, ConnectedBillingTickIntents> {
  return (state, ctx) => {
    const at = Math.max(ctx.at, ctx.now);
    const settled = at >= bootedAt + CONNECTED_BILLING_FIRST_DELAY_MS;
    const tickedSinceBoot = state.lastTickAt !== null && state.lastTickAt >= bootedAt;
    const dayElapsed =
      state.lastTickAt !== null && at - state.lastTickAt >= CONNECTED_BILLING_TICK_INTERVAL_MS;
    if (!settled || (tickedSinceBoot && !dayElapsed)) return { state };
    return {
      state: { lastTickAt: at },
      intents: [ctx.intents.tick(`tick:${at}`, { scheduledFor: at })],
    };
  };
}
