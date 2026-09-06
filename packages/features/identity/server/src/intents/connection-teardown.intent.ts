import { createLogger } from "@langwatch/observability";
import type { z } from "zod";
import type {
  completeTeardownIntentSchema,
  ConnectionTeardownPort,
} from "../processes/connection-teardown.process.ts";

const logger = createLogger("langwatch:identity:connection-teardown");

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
