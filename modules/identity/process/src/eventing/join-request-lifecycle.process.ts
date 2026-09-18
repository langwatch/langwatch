import type { EventHandler, IntentSpec, WakeHandler } from "@langwatch/eventing";
import { z } from "zod";

export const JOIN_REQUEST_LIFECYCLE_PROCESS_NAME = "joinRequestLifecycle" as const;

/**
 * How long a request waits for an answer: fourteen days, matching an
 * invitation's own expiry (D11) so the two lapse on the same schedule.
 */
export const JOIN_REQUEST_EXPIRY_MS = 14 * 24 * 60 * 60 * 1000;

/**
 * When admins are reminded — once, on day seven: early enough to leave a week
 * to act, late enough not to be a second copy of the first mail. Only one,
 * because a second nag would train admins to ignore reminders altogether.
 */
export const JOIN_REQUEST_REMINDER_MS = 7 * 24 * 60 * 60 * 1000;

export const remindAdminsIntentSchema = z.object({
  joinRequestId: z.string().min(1),
  organizationId: z.string().min(1),
  scheduledFor: z.number().int(),
});

export const expireRequestIntentSchema = z.object({
  joinRequestId: z.string().min(1),
  organizationId: z.string().min(1),
  /** The slot the wake was scheduled for — business time for the command, so
   *  a lagged worker expires the request at the deadline it promised. */
  scheduledFor: z.number().int(),
});

/**
 * What the process holds while a request is open. One `nextWakeAt` column
 * means the day-7 wake re-arms to the day-14 deadline; `remindedAt` makes
 * the reminder exactly-once under redelivery.
 */
export interface JoinRequestLifecycleState {
  remindAtMs: number | null;
  expiresAtMs: number | null;
  remindedAt: number | null;
}

export const JOIN_REQUEST_LIFECYCLE_INITIAL_STATE: JoinRequestLifecycleState = {
  remindAtMs: null,
  expiresAtMs: null,
  remindedAt: null,
};

export type JoinRequestLifecycleIntents = {
  remindAdmins: IntentSpec<typeof remindAdminsIntentSchema>;
  expireRequest: IntentSpec<typeof expireRequestIntentSchema>;
};

/**
 * Where the process's two effects actually happen. The process manager
 * decides WHEN; the guard behind `expireRequest` still decides whether — it
 * re-reads the folded deadline, so a wake that fires early expires nothing.
 */
export interface JoinRequestLifecycle {
  remindAdmins(args: { joinRequestId: string; organizationId: string }): Promise<void>;
  expireRequest(args: {
    joinRequestId: string;
    organizationId: string;
    occurredAtMs: number;
  }): Promise<void>;
}

/**
 * Arms both deadlines from the fact's own creation time (`ctx.at`), not `now`
 * — deadlines are PROMISES about when the request was made, so a backed-up
 * subscriber must not buy it extra silence; an overdue wake just fires next poll.
 */
export const onJoinRequested: EventHandler<
  JoinRequestLifecycleState,
  { expiresAtMs: number },
  JoinRequestLifecycleIntents
> = (_state, data, ctx) => {
  const remindAtMs = ctx.at + JOIN_REQUEST_REMINDER_MS;
  const expiresAtMs = data.expiresAtMs;
  // A request whose window is already shorter than the reminder gap skips
  // straight to the expiry rather than waking for a reminder it would send
  // after the thing had lapsed.
  const nextWakeAt = remindAtMs < expiresAtMs ? remindAtMs : expiresAtMs;
  return {
    state: { remindAtMs, expiresAtMs, remindedAt: null },
    nextWakeAt,
  };
};

/**
 * Disarm. Every ending is terminal: nothing is left to wake for, and a wake
 * that still fired would dispatch a command the guard refuses and send a
 * reminder about a request nobody can answer.
 */
export const onJoinResolved: EventHandler<
  JoinRequestLifecycleState,
  unknown,
  JoinRequestLifecycleIntents
> = () => ({
  state: JOIN_REQUEST_LIFECYCLE_INITIAL_STATE,
  nextWakeAt: null,
});

/**
 * Pure and synchronous: the persisted commit fences racing workers to exactly
 * one. Two slots share one timer — day 7 reminds and re-arms to day 14, day 14
 * expires; `remindedAt` makes the reminder exactly-once under redelivery.
 */
export const joinRequestLifecycleWake: WakeHandler<
  JoinRequestLifecycleState,
  JoinRequestLifecycleIntents
> = (state, ctx) => {
  if (state.expiresAtMs === null) {
    return { state, nextWakeAt: null };
  }

  const expiresAtMs = state.expiresAtMs;
  const dueToExpire = ctx.at >= expiresAtMs;

  if (dueToExpire) {
    return {
      state: JOIN_REQUEST_LIFECYCLE_INITIAL_STATE,
      nextWakeAt: null,
      intents: [
        ctx.intents.expireRequest(`join-expire:${expiresAtMs}`, {
          joinRequestId: ctx.key,
          organizationId: ctx.projectId,
          scheduledFor: expiresAtMs,
        }),
      ],
    };
  }

  if (state.remindedAt !== null) {
    return { state, nextWakeAt: expiresAtMs };
  }

  return {
    state: { ...state, remindedAt: ctx.at },
    nextWakeAt: expiresAtMs,
    intents: [
      ctx.intents.remindAdmins(`join-remind:${state.remindAtMs ?? ctx.at}`, {
        joinRequestId: ctx.key,
        organizationId: ctx.projectId,
        scheduledFor: ctx.at,
      }),
    ],
  };
};
