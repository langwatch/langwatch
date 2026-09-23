import type { EventHandler, IntentContext, IntentSpec, WakeHandler } from "@langwatch/eventing";
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
  // Reminders queued before the identity fields existed carry neither; the
  // executor fills them from the join-request projection.
  requesterUserId: z.string().min(1).optional(),
  domain: z.string().min(1).optional(),
  scheduledFor: z.number().int(),
});

export const expireRequestIntentSchema = z.object({
  joinRequestId: z.string().min(1),
  organizationId: z.string().min(1),
  /** The slot the wake was scheduled for — business time for the command, so
   *  a lagged worker expires the request at the deadline it promised. */
  scheduledFor: z.number().int(),
});

export const JOIN_REQUEST_NOTIFICATION_KINDS = [
  "requestArrived",
  "requestStillWaiting",
  "requestApproved",
  "requestRejected",
  "requestExpired",
  "joinedAutomatically",
] as const;

export type JoinRequestNotificationKind = (typeof JOIN_REQUEST_NOTIFICATION_KINDS)[number];

/** One notice, derived from a recorded fact, so the handoff cannot be lost after the command. */
export const joinRequestNotificationIntentSchema = z.object({
  kind: z.enum(JOIN_REQUEST_NOTIFICATION_KINDS),
  notificationId: z.string().min(1),
  joinRequestId: z.string().min(1),
  organizationId: z.string().min(1),
  // Terminal notices for a process armed before these fields existed omit them.
  requesterUserId: z.string().min(1).optional(),
  domain: z.string().min(1).optional(),
});

export type JoinRequestNotification = z.infer<typeof joinRequestNotificationIntentSchema>;

/**
 * What the process holds while a request is open. One `nextWakeAt` column
 * means the day-7 wake re-arms to the day-14 deadline; `remindedAt` makes the
 * reminder exactly-once. Who asked and on which domain ride along for notices.
 */
export interface JoinRequestLifecycleState {
  remindAtMs: number | null;
  expiresAtMs: number | null;
  remindedAt: number | null;
  joinRequestId: string | null;
  organizationId: string | null;
  requesterUserId: string | null;
  domain: string | null;
}

export const JOIN_REQUEST_LIFECYCLE_INITIAL_STATE: JoinRequestLifecycleState = {
  remindAtMs: null,
  expiresAtMs: null,
  remindedAt: null,
  joinRequestId: null,
  organizationId: null,
  requesterUserId: null,
  domain: null,
};

export type JoinRequestLifecycleIntents = {
  remindAdmins: IntentSpec<typeof remindAdminsIntentSchema>;
  expireRequest: IntentSpec<typeof expireRequestIntentSchema>;
  prepareNotification: IntentSpec<typeof joinRequestNotificationIntentSchema>;
};

/**
 * Where the process's effects actually happen. The process manager decides
 * WHEN; the guard behind `expireRequest` still decides whether, and the
 * notification executor re-reads who is told before telling them.
 */
export interface JoinRequestLifecycle {
  expireRequest(args: {
    joinRequestId: string;
    organizationId: string;
    occurredAtMs: number;
  }): Promise<void>;
  prepareNotification(args: {
    payload: JoinRequestNotification;
    context: IntentContext;
  }): Promise<void>;
}

type LifecycleContext = Parameters<
  EventHandler<JoinRequestLifecycleState, unknown, JoinRequestLifecycleIntents>
>[2];

/** The notice for one ending, keyed so a redelivered event queues it once. */
function notificationIntent({
  state,
  kind,
  ctx,
}: {
  state: JoinRequestLifecycleState;
  kind: JoinRequestNotificationKind;
  ctx: LifecycleContext;
}) {
  const joinRequestId = state.joinRequestId ?? ctx.key;
  return ctx.intents.prepareNotification(`join-notification:${joinRequestId}:${kind}`, {
    kind,
    notificationId: `join:${joinRequestId}:${kind}`,
    joinRequestId,
    organizationId: state.organizationId ?? ctx.projectId,
    ...(state.requesterUserId ? { requesterUserId: state.requesterUserId } : {}),
    ...(state.domain ? { domain: state.domain } : {}),
  });
}

/**
 * Arms both deadlines from the fact's own creation time (`ctx.at`), not `now`
 * — deadlines are PROMISES about when the request was made — and tells the
 * admins a request arrived unless the policy approves it on the spot.
 */
export const onJoinRequested: EventHandler<
  JoinRequestLifecycleState,
  {
    joinRequestId: string;
    organizationId: string;
    userId: string;
    domain: string;
    expiresAtMs: number;
    notifyAdmins: boolean;
  },
  JoinRequestLifecycleIntents
> = (_state, data, ctx) => {
  const remindAtMs = ctx.at + JOIN_REQUEST_REMINDER_MS;
  const expiresAtMs = data.expiresAtMs;
  // A request whose window is already shorter than the reminder gap skips
  // straight to the expiry rather than waking for a reminder it would send
  // after the thing had lapsed.
  const nextWakeAt = remindAtMs < expiresAtMs ? remindAtMs : expiresAtMs;
  const state: JoinRequestLifecycleState = {
    remindAtMs,
    expiresAtMs,
    remindedAt: null,
    joinRequestId: data.joinRequestId,
    organizationId: data.organizationId,
    requesterUserId: data.userId,
    domain: data.domain,
  };
  return {
    state,
    nextWakeAt,
    ...(data.notifyAdmins
      ? { intents: [notificationIntent({ state, kind: "requestArrived", ctx })] }
      : {}),
  };
};

/** An admin said yes, or the domain policy did; an invitation's answer tells nobody. */
const APPROVAL_NOTICE: Record<"user" | "policy" | "invite", JoinRequestNotificationKind | null> = {
  user: "requestApproved",
  policy: "joinedAutomatically",
  invite: null,
};

export const onJoinApproved: EventHandler<
  JoinRequestLifecycleState,
  { resolvedBy: { type: "user" | "policy" | "invite"; id: string } },
  JoinRequestLifecycleIntents
> = (state, data, ctx) => {
  const kind = APPROVAL_NOTICE[data.resolvedBy.type];
  if (kind === null) return { state: JOIN_REQUEST_LIFECYCLE_INITIAL_STATE, nextWakeAt: null };
  return {
    state: JOIN_REQUEST_LIFECYCLE_INITIAL_STATE,
    nextWakeAt: null,
    intents: [notificationIntent({ state, kind, ctx })],
  };
};

export const onJoinRejected: EventHandler<
  JoinRequestLifecycleState,
  unknown,
  JoinRequestLifecycleIntents
> = (state, _data, ctx) => ({
  state: JOIN_REQUEST_LIFECYCLE_INITIAL_STATE,
  nextWakeAt: null,
  intents: [notificationIntent({ state, kind: "requestRejected", ctx })],
});

/** The expiry is announced from the recorded fact, never from the wake that asked for it. */
export const onJoinExpired: EventHandler<
  JoinRequestLifecycleState,
  unknown,
  JoinRequestLifecycleIntents
> = (state, _data, ctx) => ({
  state: JOIN_REQUEST_LIFECYCLE_INITIAL_STATE,
  nextWakeAt: null,
  intents: [notificationIntent({ state, kind: "requestExpired", ctx })],
});

/**
 * Disarm. A withdrawal is terminal: nothing is left to wake for, and a wake
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
 * one. Day 7 reminds and re-arms to day 14; day 14 expires, keeping the facts
 * until the expiry event queues the requester's notice.
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
      state,
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
        ...(state.requesterUserId ? { requesterUserId: state.requesterUserId } : {}),
        ...(state.domain ? { domain: state.domain } : {}),
        scheduledFor: ctx.at,
      }),
    ],
  };
};
