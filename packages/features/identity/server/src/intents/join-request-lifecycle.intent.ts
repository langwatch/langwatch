import { createLogger } from "@langwatch/observability";
import type { z } from "zod";
import type {
  expireRequestIntentSchema,
  JoinRequestLifecyclePort,
  remindAdminsIntentSchema,
} from "../processes/join-request-lifecycle.process";

const logger = createLogger("langwatch:identity:join-request-lifecycle");

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
