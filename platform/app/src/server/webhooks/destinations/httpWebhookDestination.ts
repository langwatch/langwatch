import {
  classifyWebhookStatus,
  sendWebhook,
  WEBHOOK_DELIVERY_ID_HEADER,
} from "../sendWebhook";
import { allowsInsecureLocalUrls } from "../urlPolicy";
import type {
  WebhookDestination,
  WebhookDispatchRequest,
  WebhookDispatchResult,
} from "./types";

/** How much of the receiver's response the delivery log keeps. */
const RESPONSE_SNIPPET_CHARS = 1000;

/**
 * The HTTPS destination: the transport every endpoint used before there was
 * more than one.
 *
 * It is a thin wrapper over the untouched `sendWebhook` — same SSRF fence,
 * same timeout, same redirect refusal, same signature, same dispatch cap —
 * that turns the receiver's status into the verdict the recorder used to
 * derive for itself. The classification is `classifyWebhookStatus`, the same
 * function the throwing assertion uses, so this cannot drift from what the
 * platform has always done.
 */
export function httpWebhookDestination({ url }: { url: string }): WebhookDestination {
  return {
    kind: "http",
    async send(request: WebhookDispatchRequest): Promise<WebhookDispatchResult> {
      const result = await sendWebhook({
        url,
        body: request.body,
        triggerName: request.endpointId,
        contextLabel: `Webhook endpoint ${request.endpointId}${
          request.isTestFire ? " (test)" : ""
        }`,
        // Endpoints are organization-scoped, so their dispatch cap buckets
        // per organization rather than per project. A test fire passes no
        // scope, which is how it stays exempt.
        ...(request.isTestFire
          ? { testFire: true }
          : { projectId: request.organizationId }),
        eventId: request.batchId,
        dispatchIdHeader: WEBHOOK_DELIVERY_ID_HEADER,
        signingSecrets: request.signingSecrets,
        attempt: request.attempt,
        allowInsecureLocal: allowsInsecureLocalUrls(),
      });

      const verdict = classifyWebhookStatus(result.status);
      return {
        verdict,
        status: result.status,
        body: result.body.slice(0, RESPONSE_SNIPPET_CHARS),
        ...(result.responseHeaders ? { responseHeaders: result.responseHeaders } : {}),
        ...(result.retryAfterMs !== undefined
          ? { retryAfterMs: result.retryAfterMs }
          : {}),
        dispatchId: result.eventId,
        ...(verdict === "success" ? {} : { error: `HTTP ${result.status}` }),
      };
    },
  };
}
