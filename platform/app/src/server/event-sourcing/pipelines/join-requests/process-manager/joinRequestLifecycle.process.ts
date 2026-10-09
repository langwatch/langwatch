import { createLogger } from "@langwatch/observability";
import { z } from "zod";
import type {
  EventHandler,
  IntentContext,
  IntentSpec,
  WakeHandler,
} from "~/server/event-sourcing/pipeline/processManagerDefinition";

const logger = createLogger("langwatch:identity:join-request-lifecycle");

export const JOIN_REQUEST_LIFECYCLE_PROCESS_NAME =
  "joinRequestLifecycle" as const;

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
  // Old queued reminders predate the identity fields; their executor fills
  // them from the authoritative JoinRequest projection.
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

export const joinRequestNotificationIntentSchema = z.object({
  kind: z.enum(JOIN_REQUEST_NOTIFICATION_KINDS),
  notificationId: z.string().min(1),
  joinRequestId: z.string().min(1),
  organizationId: z.string().min(1),
  // Old queued reminders and terminal notices do not carry these fields.
  requesterUserId: z.string().min(1).optional(),
  domain: z.string().min(1).optional(),
  admissionId: z.string().min(1).optional(),
});

const joinRequestNotificationContentSchema = z.object({
  to: z.string().min(1),
  subject: z.string().min(1),
  html: z.string().min(1),
  from: z.string().min(1),
  idempotencyKey: z.string().min(1),
});

export const joinRequestNotificationFanoutSchema = z.object({
  notificationId: z.string().min(1),
  kind: z.enum(JOIN_REQUEST_NOTIFICATION_KINDS),
  joinRequestId: z.string().min(1),
  organizationId: z.string().min(1),
  requesterUserId: z.string().min(1),
  admissionId: z.string().min(1).optional(),
  messages: z.array(
    z.object({
      recipientUserId: z.string().min(1),
      isAdmin: z.boolean(),
      content: joinRequestNotificationContentSchema,
    }),
  ),
});

export const joinRequestNotificationDeliverySchema = z.object({
  kind: z.enum(JOIN_REQUEST_NOTIFICATION_KINDS),
  joinRequestId: z.string().min(1),
  organizationId: z.string().min(1),
  requesterUserId: z.string().min(1),
  admissionId: z.string().min(1).optional(),
  recipientUserId: z.string().min(1),
  isAdmin: z.boolean(),
  content: joinRequestNotificationContentSchema,
});

export const attachMembershipGrantIntentSchema = z.object({
  joinRequestId: z.string().min(1),
  organizationId: z.string().min(1),
  userId: z.string().min(1),
  bindingId: z.string().min(1),
  commandId: z.string().min(1),
  occurredAtMs: z.number().int().nonnegative(),
  membershipStamp: z.string().min(1),
  approvedByUserId: z.string().min(1).nullable(),
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
  attachMembershipGrant: IntentSpec<typeof attachMembershipGrantIntentSchema>;
  remindAdmins: IntentSpec<typeof remindAdminsIntentSchema>;
  expireRequest: IntentSpec<typeof expireRequestIntentSchema>;
  prepareNotification: IntentSpec<typeof joinRequestNotificationIntentSchema>;
  fanoutNotification: IntentSpec<typeof joinRequestNotificationFanoutSchema>;
  sendNotification: IntentSpec<typeof joinRequestNotificationDeliverySchema>;
};

/**
 * Where the process's two effects actually happen. The process manager
 * decides WHEN; the guard behind `expireRequest` still decides whether — it
 * re-reads the folded deadline, so a wake that fires early expires nothing.
 */
export interface JoinRequestLifecyclePort {
  attachMembershipGrant(
    payload: z.infer<typeof attachMembershipGrantIntentSchema>,
  ): Promise<void>;
  expireRequest(args: {
    joinRequestId: string;
    organizationId: string;
    occurredAtMs: number;
  }): Promise<void>;
  prepareNotification(args: {
    payload: z.infer<typeof joinRequestNotificationIntentSchema>;
    context: IntentContext;
  }): Promise<void>;
  fanoutNotification(args: {
    payload: z.infer<typeof joinRequestNotificationFanoutSchema>;
    context: IntentContext;
  }): Promise<void>;
  sendNotification(
    payload: z.infer<typeof joinRequestNotificationDeliverySchema>,
  ): Promise<void>;
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
  return {
    state: {
      remindAtMs,
      expiresAtMs,
      remindedAt: null,
      joinRequestId: data.joinRequestId,
      organizationId: data.organizationId,
      requesterUserId: data.userId,
      domain: data.domain,
    },
    nextWakeAt,
    ...(data.notifyAdmins
      ? {
          intents: [
            ctx.intents.prepareNotification(
              `join-notification:${data.joinRequestId}:requestArrived`,
              {
                kind: "requestArrived",
                notificationId: `join:${data.joinRequestId}:requestArrived`,
                joinRequestId: data.joinRequestId,
                organizationId: data.organizationId,
                requesterUserId: data.userId,
                domain: data.domain,
              },
            ),
          ],
        }
      : {}),
  };
};

export const onJoinApproved: EventHandler<
  JoinRequestLifecycleState,
  { resolvedBy: { type: "user" | "policy" | "invite"; id: string } },
  JoinRequestLifecycleIntents
> = (state, data, ctx) => {
  const joinRequestId = state.joinRequestId ?? ctx.key;
  const organizationId = state.organizationId ?? ctx.projectId;
  const kind =
    data.resolvedBy.type === "policy"
      ? "joinedAutomatically"
      : data.resolvedBy.type === "user"
        ? "requestApproved"
        : null;
  if (kind === null) {
    return { state: JOIN_REQUEST_LIFECYCLE_INITIAL_STATE, nextWakeAt: null };
  }
  return {
    state: JOIN_REQUEST_LIFECYCLE_INITIAL_STATE,
    nextWakeAt: null,
    intents: [
      ctx.intents.prepareNotification(
        `join-notification:${joinRequestId}:${kind}`,
        {
          kind,
          notificationId: `join:${joinRequestId}:${kind}`,
          joinRequestId,
          organizationId,
          ...(state.requesterUserId
            ? { requesterUserId: state.requesterUserId }
            : {}),
          ...(state.domain ? { domain: state.domain } : {}),
        },
      ),
    ],
  };
};

export const onJoinRejected: EventHandler<
  JoinRequestLifecycleState,
  unknown,
  JoinRequestLifecycleIntents
> = (state, _data, ctx) => resolvedNotification(state, "requestRejected", ctx);

export const onJoinExpired: EventHandler<
  JoinRequestLifecycleState,
  unknown,
  JoinRequestLifecycleIntents
> = (state, _data, ctx) => resolvedNotification(state, "requestExpired", ctx);

function resolvedNotification(
  state: JoinRequestLifecycleState,
  kind: "requestRejected" | "requestExpired",
  ctx: Parameters<
    EventHandler<
      JoinRequestLifecycleState,
      unknown,
      JoinRequestLifecycleIntents
    >
  >[2],
) {
  const joinRequestId = state.joinRequestId ?? ctx.key;
  const organizationId = state.organizationId ?? ctx.projectId;
  return {
    state: JOIN_REQUEST_LIFECYCLE_INITIAL_STATE,
    nextWakeAt: null,
    intents: [
      ctx.intents.prepareNotification(
        `join-notification:${joinRequestId}:${kind}`,
        {
          kind,
          notificationId: `join:${joinRequestId}:${kind}`,
          joinRequestId,
          organizationId,
          ...(state.requesterUserId
            ? { requesterUserId: state.requesterUserId }
            : {}),
          ...(state.domain ? { domain: state.domain } : {}),
        },
      ),
    ],
  };
}

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
      // Keep the request facts until the expiry event is folded. The event
      // handler owns terminal cleanup and needs them to enqueue the requester
      // notice; clearing them here would make expiry silently unnotified.
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
        ...(state.requesterUserId
          ? { requesterUserId: state.requesterUserId }
          : {}),
        ...(state.domain ? { domain: state.domain } : {}),
        scheduledFor: ctx.at,
      }),
    ],
  };
};

export function runRemindAdmins(deps: { port: JoinRequestLifecyclePort }) {
  return async (
    payload: z.infer<typeof remindAdminsIntentSchema>,
    context: IntentContext,
  ): Promise<void> => {
    await deps.port.prepareNotification({
      payload: {
        kind: "requestStillWaiting",
        notificationId: `join:${payload.joinRequestId}:requestStillWaiting`,
        joinRequestId: payload.joinRequestId,
        organizationId: payload.organizationId,
        requesterUserId: payload.requesterUserId,
        domain: payload.domain,
      },
      context,
    });
    logger.info(
      { joinRequestId: payload.joinRequestId },
      "join request still unanswered at the halfway mark; admins reminded",
    );
  };
}

export function runAttachMembershipGrant(deps: {
  port: JoinRequestLifecyclePort;
}) {
  return async (
    payload: z.infer<typeof attachMembershipGrantIntentSchema>,
  ): Promise<void> => {
    await deps.port.attachMembershipGrant(payload);
  };
}

export function runExpireRequest(deps: { port: JoinRequestLifecyclePort }) {
  return async (
    payload: z.infer<typeof expireRequestIntentSchema>,
  ): Promise<void> => {
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

export function runPrepareNotification(deps: {
  port: JoinRequestLifecyclePort;
}) {
  return async (
    payload: z.infer<typeof joinRequestNotificationIntentSchema>,
    context: IntentContext,
  ): Promise<void> => {
    await deps.port.prepareNotification({ payload, context });
  };
}

export function runSendNotification(deps: { port: JoinRequestLifecyclePort }) {
  return async (
    payload: z.infer<typeof joinRequestNotificationDeliverySchema>,
  ): Promise<void> => {
    await deps.port.sendNotification(payload);
  };
}

export function runFanoutNotification(deps: {
  port: JoinRequestLifecyclePort;
}) {
  return async (
    payload: z.infer<typeof joinRequestNotificationFanoutSchema>,
    context: IntentContext,
  ): Promise<void> => {
    await deps.port.fanoutNotification({ payload, context });
  };
}
