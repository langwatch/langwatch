import { createLogger } from "@langwatch/observability";
import { z } from "zod";
import type { EventHandler, IntentSpec, WakeHandler } from "@langwatch/eventing";

const logger = createLogger("langwatch:identity:connection-teardown");

export const CONNECTION_TEARDOWN_PROCESS_NAME = "connectionTeardown" as const;

/**
 * How long a requested teardown stays reversible.
 *
 * Seven days, because the thing being removed is how a whole organization
 * signs in: a teardown started on a Friday by someone who then goes on leave
 * has to be undoable by a colleague on the Monday, and an operator who
 * realizes the mistake a week later still has room. Nothing is torn down
 * silently in the meantime — TEARDOWN_PENDING stops routing the moment it is
 * requested, so the grace costs no exposure, only patience.
 */
export const CONNECTION_TEARDOWN_GRACE_MS = 7 * 24 * 60 * 60 * 1000;

export const completeTeardownIntentSchema = z.object({
  connectionId: z.string().min(1),
  organizationId: z.string().min(1),
  /** The slot the wake was scheduled for — business time for the command. */
  scheduledFor: z.number().int(),
});

export interface ConnectionTeardownState {
  /** The deadline, while one is armed. Null means nothing is pending. */
  tearDownAfterMs: number | null;
}

export const CONNECTION_TEARDOWN_INITIAL_STATE: ConnectionTeardownState = {
  tearDownAfterMs: null,
};

export type ConnectionTeardownIntents = {
  completeTeardown: IntentSpec<typeof completeTeardownIntentSchema>;
};

/**
 * What actually completes a teardown: dispatching the guarded
 * `completeTeardown` command. The process manager decides WHEN; the guard
 * still decides whether — it re-reads the folded deadline, so a wake that
 * fires early (a lagged queue, a replayed job) cannot complete anything.
 */
export interface ConnectionTeardownPort {
  completeTeardown(args: {
    connectionId: string;
    organizationId: string;
    occurredAtMs: number;
  }): Promise<void>;
}

/**
 * Arm the deadline the request carried. `nextWakeAt` is the fact's own
 * `tearDownAfterMs` rather than `now + grace`: the request decided the
 * deadline, and a wake computed here would drift every time the event was
 * redelivered.
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
      ctx.intents.completeTeardown(`teardown:${state.tearDownAfterMs}`, {
        connectionId: ctx.key,
        organizationId: ctx.projectId,
        scheduledFor: state.tearDownAfterMs,
      }),
    ],
  };
};

export function runCompleteTeardown(deps: { port: ConnectionTeardownPort }) {
  return async (payload: z.infer<typeof completeTeardownIntentSchema>): Promise<void> => {
    await deps.port.completeTeardown({
      connectionId: payload.connectionId,
      organizationId: payload.organizationId,
      occurredAtMs: payload.scheduledFor,
    });
    logger.info(
      { connectionId: payload.connectionId },
      "sso connection teardown grace elapsed; completion command dispatched",
    );
  };
}
