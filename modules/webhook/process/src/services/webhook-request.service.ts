import { DispatchError, isDispatchError } from "@langwatch/eventing";
import { createLogger } from "@langwatch/observability";
import { nowInstant, toDate } from "@langwatch/time";
import type {
  WebhookRequestDelivery,
  WebhookRequestFailureResponse,
  WebhookRequestSource,
  WebhookSendRequest,
  WebhookSendRequestResult,
} from "@langwatch/webhook-contract";

import type {
  WebhookEndpointRepository,
  WebhookRequestAttempt,
} from "../repositories/webhook-endpoint.repository.ts";
import {
  judgeWebhookDelivery,
  type WebhookSendResult,
} from "../rules/webhook-delivery-classification.rules.ts";
import type { WebhookEgressService } from "./webhook-egress.service.ts";

const logger = createLogger("langwatch:webhook-delivery");

/** How much of the failure message the log row keeps. */
const LOG_ERROR_CHARS = 500;
/** How much of the receiver's failure response body the log row keeps. */
const LOG_RESPONSE_CHARS = 4000;

function failureResponseOf(result: WebhookSendResult): WebhookRequestFailureResponse {
  return {
    body: result.body.slice(0, LOG_RESPONSE_CHARS),
    ...(result.responseHeaders ? { headers: result.responseHeaders } : {}),
    ...(result.retryAfterMs !== undefined ? { retryAfterMs: result.retryAfterMs } : {}),
  };
}

/**
 * One request to a customer URL per call (ADR-167 step 1): fence, cap, sign, send,
 * classify, and file the attempt in the delivery log. Retry is the caller's outbox.
 */
export class WebhookRequestService {
  private constructor(
    private readonly egress: Pick<WebhookEgressService, "send">,
    private readonly deliveries: Pick<
      WebhookEndpointRepository,
      "recordRequestAttempt" | "findRequestAttempts"
    >,
  ) {}

  static create(input: {
    egress: Pick<WebhookEgressService, "send">;
    deliveries: Pick<WebhookEndpointRepository, "recordRequestAttempt" | "findRequestAttempts">;
  }): WebhookRequestService {
    return new WebhookRequestService(input.egress, input.deliveries);
  }

  async send(request: WebhookSendRequest): Promise<WebhookSendRequestResult> {
    const startedAt = nowInstant().epochMilliseconds;
    const base = {
      projectId: request.projectId,
      triggerId: request.source.ref,
      dispatchId: request.dispatchId,
    };
    let result: WebhookSendResult | undefined;
    try {
      result = await this.egress.send({
        url: request.url,
        method: request.method,
        headers: request.headers,
        body: request.body,
        signingSecrets: request.signingSecrets,
        projectId: request.projectId,
        eventId: request.dispatchId,
        triggerName: request.source.ref,
        contextLabel: request.label,
      });
      const verdict = judgeWebhookDelivery({ result, label: request.label });
      if (!verdict.delivered) {
        throw new DispatchError({
          message: verdict.message,
          retryable: verdict.retryable,
          retryAfterMs: verdict.retryAfterMs,
        });
      }
      await this.record({
        ...base,
        outcome: "success",
        responseStatus: result.status,
        latencyMs: nowInstant().epochMilliseconds - startedAt,
        error: null,
        response: null,
      });
      return { status: result.status, dispatchId: result.eventId };
    } catch (error) {
      // The message is built from the response side only; the request never lands here.
      await this.record({
        ...base,
        outcome: isDispatchError(error) && error.retryable ? "retryable" : "terminal",
        responseStatus: result?.status ?? null,
        latencyMs: nowInstant().epochMilliseconds - startedAt,
        error: (error instanceof Error ? error.message : String(error)).slice(0, LOG_ERROR_CHARS),
        response: result ? failureResponseOf(result) : null,
      });
      throw error;
    }
  }

  async findBySource(input: {
    projectId: string;
    source: WebhookRequestSource;
    limit: number;
  }): Promise<WebhookRequestDelivery[]> {
    const rows = await this.deliveries.findRequestAttempts({
      projectId: input.projectId,
      triggerId: input.source.ref,
      limit: input.limit,
    });
    return rows.map((row) => ({
      id: row.id,
      ref: row.triggerId,
      dispatchId: row.dispatchId,
      responseStatus: row.responseStatus,
      latencyMs: row.latencyMs,
      error: row.error,
      response: row.response,
      outcome: row.outcome,
      firedAt: toDate(row.firedAt),
    }));
  }

  /** Logging is a side effect: a failed write never changes the attempt's answer. */
  private async record(attempt: WebhookRequestAttempt): Promise<void> {
    try {
      await this.deliveries.recordRequestAttempt(attempt);
    } catch (error) {
      logger.warn(
        { projectId: attempt.projectId, triggerId: attempt.triggerId, error },
        "Failed to record webhook delivery attempt — dispatch unaffected",
      );
    }
  }
}
