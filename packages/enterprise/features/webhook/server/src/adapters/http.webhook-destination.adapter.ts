import {
  classifyWebhookStatus,
  WEBHOOK_DELIVERY_ID_HEADER,
  type WebhookEgressService,
} from "@langwatch/egress";

import type {
  WebhookDestination,
  WebhookDispatchRequest,
  WebhookDispatchResult,
} from "../ports/webhook-destination.port";

/** How much of the receiver's response the delivery log keeps. */
const RESPONSE_SNIPPET_CHARS = 1000;

/**
 * The HTTPS destination: the transport every endpoint used before there was
 * more than one.
 *
 * It is a thin wrapper over the untouched egress service — same SSRF fence,
 * same timeout, same redirect refusal, same signature, same dispatch cap —
 * that turns the receiver's status into the verdict the recorder used to
 * derive for itself. The classification is `classifyWebhookStatus`, the same
 * function the throwing assertion uses, so this cannot drift from what the
 * platform has always done.
 */
export function httpWebhookDestination({
  url,
  egress,
  allowInsecureLocal,
}: {
  url: string;
  /**
   * The process's ONE outbound webhook sender: the SSRF fence, the TLS policy
   * and the hourly dispatch cap all live on it, so a second instance here
   * would be a second budget and possibly a second fence.
   */
  egress: WebhookEgressService;
  /**
   * Whether this deployment permits a loopback or private destination. A
   * process-level escape hatch for local development, so the process decides
   * it rather than a module reading the environment for itself.
   */
  allowInsecureLocal: boolean;
}): WebhookDestination {
  return {
    kind: "http",
    async send(request: WebhookDispatchRequest): Promise<WebhookDispatchResult> {
      const result = await egress.send({
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
        allowInsecureLocal,
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
