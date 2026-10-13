import type { IntentContext } from "@langwatch/eventing";
import { createLogger } from "@langwatch/observability";
import type { z } from "zod";

import type {
  expireRequestIntentSchema,
  JoinRequestLifecycle,
  JoinRequestNotification,
  remindAdminsIntentSchema,
} from "./join-request-lifecycle.process.ts";

const logger = createLogger("langwatch:identity:join-request-lifecycle");

/** The day-7 nudge is one more notice, prepared the way every other one is. */
export function runRemindAdmins(deps: {
  port: JoinRequestLifecycle;
}): (payload: z.infer<typeof remindAdminsIntentSchema>, context: IntentContext) => Promise<void> {
  return async (payload, context) => {
    await deps.port.prepareNotification({
      payload: {
        kind: "requestStillWaiting",
        notificationId: `join:${payload.joinRequestId}:requestStillWaiting`,
        joinRequestId: payload.joinRequestId,
        organizationId: payload.organizationId,
        ...(payload.requesterUserId ? { requesterUserId: payload.requesterUserId } : {}),
        ...(payload.domain ? { domain: payload.domain } : {}),
      },
      context,
    });
    logger.info(
      { joinRequestId: payload.joinRequestId },
      "join request still unanswered at the halfway mark; admins reminded",
    );
  };
}

export function runExpireRequest(deps: {
  port: JoinRequestLifecycle;
}): (payload: z.infer<typeof expireRequestIntentSchema>) => Promise<void> {
  return async (payload) => {
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
  port: JoinRequestLifecycle;
}): (payload: JoinRequestNotification, context: IntentContext) => Promise<void> {
  return async (payload, context) => {
    await deps.port.prepareNotification({ payload, context });
  };
}
