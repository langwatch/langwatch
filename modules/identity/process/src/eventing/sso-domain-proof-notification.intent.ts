import { createLogger } from "@langwatch/observability";
import type { z } from "zod";

import type {
  notifyProofLapsedIntentSchema,
  notifyProofWaveringIntentSchema,
  SsoDomainProofNotifications,
} from "./sso-domain-proof-notification.process.ts";

const logger = createLogger("langwatch:identity:sso-domain-proof-notification");

export function runNotifyProofWavering(deps: {
  notifications: SsoDomainProofNotifications;
}): (payload: z.infer<typeof notifyProofWaveringIntentSchema>) => Promise<void> {
  return async (payload: z.infer<typeof notifyProofWaveringIntentSchema>): Promise<void> => {
    await deps.notifications.proofWavering({
      connectionId: payload.connectionId,
      organizationId: payload.organizationId,
      domain: payload.domain,
      graceEndsAtMs: payload.graceEndsAtMs,
    });
    logger.info(
      { connectionId: payload.connectionId, domain: payload.domain },
      "domain proof missing; administrators told there is still time",
    );
  };
}

export function runNotifyProofLapsed(deps: {
  notifications: SsoDomainProofNotifications;
}): (payload: z.infer<typeof notifyProofLapsedIntentSchema>) => Promise<void> {
  return async (payload: z.infer<typeof notifyProofLapsedIntentSchema>): Promise<void> => {
    await deps.notifications.proofLapsed({
      connectionId: payload.connectionId,
      organizationId: payload.organizationId,
      domain: payload.domain,
    });
    logger.info(
      { connectionId: payload.connectionId, domain: payload.domain },
      "domain proof lapsed; administrators told what stopped",
    );
  };
}
