import type { EventHandler, IntentSpec, WakeHandler } from "@langwatch/eventing";
import { z } from "zod";

export const CONNECTION_TEARDOWN_PROCESS_NAME = "connectionTeardown" as const;

export const completeTeardownIntentSchema = z.object({
  connectionId: z.string().min(1),
  organizationId: z.string().min(1),
  /** The slot the wake was scheduled for — business time for the command. */
  scheduledFor: z.number().int(),
});

export const connectionTeardownStateSchema = z.object({
  /** The deadline, while one is armed. Null means nothing is pending. */
  tearDownAfterMs: z.number().nullable(),
});
export type ConnectionTeardownState = z.infer<typeof connectionTeardownStateSchema>;

export const CONNECTION_TEARDOWN_INITIAL_STATE: ConnectionTeardownState = {
  tearDownAfterMs: null,
};

export type ConnectionTeardownIntents = {
  completeTeardown: IntentSpec<typeof completeTeardownIntentSchema>;
};

/**
 * What actually completes a teardown: the guarded `completeTeardown`
 * command. The manager decides WHEN; the guard re-reads the folded
 * deadline, so an early wake (lagged queue, replay) completes nothing.
 */
export interface ConnectionTeardown {
  completeTeardown: (args: {
    connectionId: string;
    organizationId: string;
    occurredAtMs: number;
  }) => Promise<void>;
}

/**
 * Arm the deadline the request carried. `nextWakeAt` is the fact's own
 * `tearDownAfterMs`, not `now + grace` — computing it here would drift on
 * every redelivery.
 */
export const onTeardownRequested: EventHandler<
  ConnectionTeardownState,
  { tearDownAfterMs: number },
  ConnectionTeardownIntents
> = (_state, data) => ({
  state: { tearDownAfterMs: data.tearDownAfterMs },
  nextWakeAt: data.tearDownAfterMs,
});

/** Disarm. A connection that reached TORN_DOWN has nothing left to wake for,
 *  and a wake that still fired would dispatch a command the guard refuses. */
export const onTornDown: EventHandler<
  ConnectionTeardownState,
  unknown,
  ConnectionTeardownIntents
> = () => ({
  state: CONNECTION_TEARDOWN_INITIAL_STATE,
  nextWakeAt: null,
});

/**
 * Pure and synchronous, like every wake handler: the commit that persists
 * this evolution is what fences racing workers, so exactly one of them
 * proceeds. The command dispatch runs as an intent behind the outbox lease.
 */
export const connectionTeardownWake: WakeHandler<
  ConnectionTeardownState,
  ConnectionTeardownIntents
> = (state, ctx) => {
  if (state.tearDownAfterMs === null) {
    return { state, nextWakeAt: null };
  }
  return {
    state: CONNECTION_TEARDOWN_INITIAL_STATE,
    nextWakeAt: null,
    intents: [
      ctx.intent("completeTeardown", `teardown:${state.tearDownAfterMs}`, {
        connectionId: ctx.key,
        organizationId: ctx.projectId,
        scheduledFor: state.tearDownAfterMs,
      }),
    ],
  };
};
