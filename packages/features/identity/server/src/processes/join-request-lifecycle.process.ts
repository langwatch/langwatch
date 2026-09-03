import { createLogger } from "@langwatch/observability";
import { z } from "zod";
import type { EventHandler, IntentSpec, WakeHandler } from "@langwatch/eventing";

const logger = createLogger("langwatch:identity:join-request-lifecycle");

export const JOIN_REQUEST_LIFECYCLE_PROCESS_NAME = "joinRequestLifecycle" as const;

/**
 * How long a request waits for an answer.
 *
 * Fourteen days, matching an invitation's own expiry (D11): the two sit in
 * one panel and a person who holds one of each should not have to remember
 * that they lapse on different schedules. It is also long enough that a
 * holiday does not silently cost somebody their team.
 */
export const JOIN_REQUEST_EXPIRY_MS = 14 * 24 * 60 * 60 * 1000;

/**
 * When the admins are reminded — once, on the seventh day.
 *
 * Halfway is deliberate: early enough that a reminder still leaves a week to
 * act on, late enough that it is not just a second copy of the first mail.
 * There is exactly one, because a request that nobody wants to answer is
 * answered by the expiry, and a second nag would train admins to ignore the
 * first.
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
 * What the process holds while a request is open.
 *
 * Two deadlines and one flag, because a process instance has exactly ONE
 * `nextWakeAt` column: the day-7 wake re-arms itself to the day-14 deadline
 * rather than a second timer existing. `remindedAt` is what makes the
 * reminder exactly-once even if the wake is redelivered.
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
export interface JoinRequestLifecyclePort {
  remindAdmins(args: { joinRequestId: string; organizationId: string }): Promise<void>;
  expireRequest(args: {
    joinRequestId: string;
    organizationId: string;
    occurredAtMs: number;
  }): Promise<void>;
}

/**
 * Arm both deadlines from the fact.
 *
 * The reminder is derived from the request's own creation time (`ctx.at`)
 * rather than `now`, which is the one place this deliberately diverges from
 * "schedule from `Math.max(at, now)`": both deadlines are PROMISES about when
 * the request was made, not delays from when the event was processed. A
 * backed-up subscriber must not buy a request an extra day of silence, and a
 * `nextWakeAt` already behind the present simply fires on the next poll —
 * which for an overdue reminder is exactly right.
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
 * Disarm. Every ending is terminal, so a request that reached one has nothing
 * left to wake for — and a wake that still fired would dispatch a command the
 * guard refuses and send a reminder about a request nobody can answer.
 *
 * This is what "no reminder and no expiry wake follows" means mechanically
 * for a withdrawal.
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
 * Pure and synchronous, like every wake handler: the commit that persists this
 * evolution is what fences racing workers, so exactly one of them proceeds.
 * The effects run as intents behind the outbox lease.
 *
 * Two slots, one timer. The first fires the reminder and re-arms to the
 * expiry; the second expires. `remindedAt` makes the first exactly-once — a
 * redelivered day-7 wake finds it set and goes straight to re-arming.
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

export function runRemindAdmins(deps: { port: JoinRequestLifecyclePort }) {
  return async (payload: z.infer<typeof remindAdminsIntentSchema>): Promise<void> => {
    await deps.port.remindAdmins({
      joinRequestId: payload.joinRequestId,
      organizationId: payload.organizationId,
    });
    logger.info(
      { joinRequestId: payload.joinRequestId },
      "join request still unanswered at the halfway mark; admins reminded",
    );
  };
}

export function runExpireRequest(deps: { port: JoinRequestLifecyclePort }) {
  return async (payload: z.infer<typeof expireRequestIntentSchema>): Promise<void> => {
    await deps.port.expireRequest({
      joinRequestId: payload.joinRequestId,
      organizationId: payload.organizationId,
      occurredAtMs: payload.scheduledFor,
    });
    logger.info(
      { joinRequestId: payload.joinRequestId },
      "join request window elapsed; expiry command dispatched",
    );
  };
}
