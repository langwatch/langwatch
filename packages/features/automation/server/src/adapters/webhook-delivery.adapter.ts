import type {
  WebhookDeliveryInput,
  WebhookFailureResponse,
  WebhookMethod,
} from "@langwatch/automation-contract";
import { isDispatchError } from "@langwatch/eventing";
import { createLogger } from "@langwatch/observability";

const logger = createLogger("langwatch:webhook-delivery");

/** Records one attempt of the delivery log (ADR-040 §6). Optional — the
 *  test-fire path passes none, so nothing is logged for ephemeral tests. */
export type WebhookDeliveryRecorder = (input: WebhookDeliveryInput) => Promise<void>;

export interface WebhookSendResult {
  status: number;
  body: string;
  eventId: string;
  responseHeaders?: Record<string, string>;
  retryAfterMs?: number;
}

export interface WebhookDeliveryTransport {
  send(input: {
    url: string;
    method?: WebhookMethod;
    headers?: Record<string, string>;
    signingSecrets?: readonly string[];
    body: string;
    triggerName: string;
    projectId: string;
    eventId: string;
  }): Promise<WebhookSendResult>;
  assertDelivered(input: { result: WebhookSendResult; triggerName: string }): void;
}

export interface WebhookDeliveryRequest {
  recorder?: WebhookDeliveryRecorder;
  projectId: string;
  triggerId: string;
  eventId: string;
  url: string;
  method?: WebhookMethod;
  headers?: Record<string, string>;
  signingSecrets?: readonly string[];
  body: string;
  triggerName: string;
}

/** How much of the failure message the log row keeps. */
const LOG_ERROR_CHARS = 500;
/** How much of the receiver's failure response body the log row keeps. */
const LOG_RESPONSE_CHARS = 4000;

function captureFailureResponse({
  result,
}: {
  result: WebhookSendResult | undefined;
}): WebhookFailureResponse | null {
  if (!result) return null;
  return {
    body: result.body.slice(0, LOG_RESPONSE_CHARS),
    ...(result.responseHeaders ? { headers: result.responseHeaders } : {}),
    ...(result.retryAfterMs !== undefined ? { retryAfterMs: result.retryAfterMs } : {}),
  };
}

/**
 * Send one webhook dispatch AND record its outcome to the delivery log
 * (ADR-040 §5 + §6) as a single unit: on 2xx a `success` row, on a classified
 * non-2xx a `retryable`/`terminal` row, on a transport/SSRF throw a row with
 * the error and no status. A failed attempt keeps the receiver's truncated
 * response (body + headers) VERBATIM for debugging — industry-baseline
 * plaintext, deliberately unredacted (ADR-040 §6: what the receiver echoes
 * is the receiver's own output; our request content is never stored at all),
 * deleted with the row by the prune. The classified DispatchError is always
 * re-thrown so the outbox retry contract is unchanged — logging is a side
 * effect that never swallows a dispatch failure, and a logging failure never
 * breaks dispatch.
 */
async function deliverWebhook({
  transport,
  recorder,
  projectId,
  triggerId,
  eventId,
  url,
  method,
  headers,
  signingSecrets,
  body,
  triggerName,
}: WebhookDeliveryRequest & { transport: WebhookDeliveryTransport }): Promise<WebhookSendResult> {
  const startedAt = Date.now();
  const baseRow = { projectId, triggerId, dispatchId: eventId };
  const safeRecord = async (row: WebhookDeliveryInput) => {
    if (!recorder) return;
    try {
      await recorder(row);
    } catch (err) {
      logger.warn(
        { projectId, triggerId, error: err },
        "Failed to record webhook delivery attempt — dispatch unaffected",
      );
    }
  };

  let result: WebhookSendResult | undefined;
  try {
    result = await transport.send({
      url,
      method,
      headers,
      signingSecrets,
      body,
      triggerName,
      projectId,
      eventId,
    });
    // Throws a classified DispatchError on a non-2xx (ADR-040 §5).
    transport.assertDelivered({ result, triggerName });
    await safeRecord({
      ...baseRow,
      responseStatus: result.status,
      latencyMs: Date.now() - startedAt,
      outcome: "success",
    });
    return result;
  } catch (err) {
    const retryable = isDispatchError(err) && err.retryable;
    // The classified message may quote the receiver's error response —
    // stored as-is. Our request content (URL, headers, body) never appears
    // here; the message is built from the response side only.
    const error = (err instanceof Error ? err.message : String(err)).slice(0, LOG_ERROR_CHARS);
    await safeRecord({
      ...baseRow,
      responseStatus: result?.status ?? null,
      latencyMs: Date.now() - startedAt,
      error,
      response: captureFailureResponse({ result }),
      outcome: retryable ? "retryable" : "terminal",
    });
    throw err;
  }
}

/** Process-owned webhook delivery adapter. The host binds its outbound HTTP
 * transport once; this class retains delivery-log and error semantics for all
 * callers, including workers and test-fire composition. */
export class WebhookDeliveryAdapter {
  private constructor(private readonly transport: WebhookDeliveryTransport) {}

  static create(transport: WebhookDeliveryTransport): WebhookDeliveryAdapter {
    return new WebhookDeliveryAdapter(transport);
  }

  deliver(request: WebhookDeliveryRequest): Promise<WebhookSendResult> {
    return deliverWebhook({ ...request, transport: this.transport });
  }
}
