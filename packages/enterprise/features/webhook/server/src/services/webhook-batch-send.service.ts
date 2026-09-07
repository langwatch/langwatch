// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * Level 2 of delivery: hand one frozen batch to one endpoint's transport and record what came
 * back. The transport answers with an already-classified verdict, because only it knows how
 * its answer is read — an HTTPS receiver has a status code, a queue has a message id.
 */

import type { IntentContext } from "@langwatch/eventing";
import { DispatchError } from "@langwatch/eventing";
import { createLogger } from "@langwatch/observability";
import type {
  IntentExecutor,
  SendBatchPayload,
  WebhookDispatchResult,
} from "../rules/webhook-delivery-contract.rules.ts";
import type { WebhookDeliveryProcessDeps } from "./webhook-delivery.service.ts";

const logger = createLogger("langwatch:webhooks:delivery-process");

export class WebhookBatchSendService {
  static create(deps: WebhookDeliveryProcessDeps): WebhookBatchSendService {
    return new WebhookBatchSendService(deps);
  }

  private constructor(private readonly deps: WebhookDeliveryProcessDeps) {}

  /**
   * Level 2: deliver one frozen batch to one endpoint through whichever
   * transport it named, and record what came back.
   */
  run(): IntentExecutor<SendBatchPayload> {
    return async (payload: SendBatchPayload, context: IntentContext): Promise<void> => {
      // The service's deliverable read owns the liveness predicate. A deleted
      // or disabled endpoint drains its queue without delivering: the spend
      // record keeps the events, re-enable plus replay covers the gap.
      const endpoint = await this.deps.endpoints.tryGetDeliverable({
        organizationId: payload.organizationId,
        endpointId: payload.endpointId,
      });
      if (!endpoint) {
        logger.info(
          { endpointId: payload.endpointId, batchId: payload.batchId },
          "webhook batch dropped: endpoint disabled or gone (replay covers the gap)",
        );

        return;
      }

      const startedAt = (this.deps.now ?? Date.now)();
      const result = await this.dispatchBatch({
        payload,
        context,
        startedAt,
      });
      await this.recordOutcome({
        payload,
        context,
        result,
        latencyMs: (this.deps.now ?? Date.now)() - startedAt,
      });
    };
  }

  /**
   * Hand one frozen batch to the endpoint's transport.
   *
   * The transport answers with an ALREADY CLASSIFIED verdict, because the
   * classification depends on the transport: an HTTPS receiver answers with a
   * status code, a queue answers with a message id and no status at all. What
   * the two share is the bytes, which are built here, once, so both transports
   * put the same body on the wire and one signature verifier reads either.
   *
   * A transport-level failure (DNS, an SSRF block, a timeout) leaves nothing to
   * classify, so the attempt is recorded here and the error rethrown:
   * DispatchError carries the retryable flag the dispatcher acts on.
   */
  private async dispatchBatch({
    payload,
    context,
    startedAt,
  }: {
    payload: SendBatchPayload;
    context: IntentContext;
    startedAt: number;
  }): Promise<WebhookDispatchResult> {
    // Two reads, run together: the secrets and the destination. The liveness
    // read above already has the row, but neither of these can be served from
    // it — both decrypt, and decryption is the service's to do, not this
    // executor's.
    const [secrets, destination] = await Promise.all([
      this.deps.endpoints.getSigningSecrets({
        organizationId: payload.organizationId,
        endpointId: payload.endpointId,
      }),
      this.deps.endpoints.getDestinationConfig({
        organizationId: payload.organizationId,
        endpointId: payload.endpointId,
      }),
    ]);
    try {
      return await this.deps.dispatch({
        destination,
        organizationId: payload.organizationId,
        endpointId: payload.endpointId,
        body: JSON.stringify({ batch: payload.envelopes }),
        batchId: payload.batchId,
        attempt: context.attempt,
        signingSecrets: secrets,
      });
    } catch (error) {
      const retryable =
        typeof error === "object" && error !== null
          ? Reflect.get(error, "retryable") !== false
          : true;
      await this.deps.endpoints.recordDeliveryAttempt({
        organizationId: payload.organizationId,
        endpointId: payload.endpointId,
        dispatchId: payload.batchId,
        attempt: context.attempt,
        eventCount: payload.envelopes.length,
        outcome: retryable ? "retryable" : "terminal",
        latencyMs: (this.deps.now ?? Date.now)() - startedAt,
        error: error instanceof Error ? error.message.slice(0, 500) : String(error),
      });

      throw error;
    }
  }

  /**
   * Record the transport's verdict and act on it: success acks, retryable
   * ladders (Retry-After honored as a floor), terminal retires the batch to
   * the dead letter immediately. The endpoint's failure streak and the 72h
   * auto-disable ride every recorded outcome.
   *
   * The verdict is the transport's, not re-derived here. A status code is only
   * one transport's way of expressing it, and a queue has none.
   */
  private async recordOutcome({
    payload,
    context,
    result,
    latencyMs,
  }: {
    payload: SendBatchPayload;
    context: IntentContext;
    result: WebhookDispatchResult;
    latencyMs: number;
  }): Promise<void> {
    const attempt: {
      organizationId: string;
      endpointId: string;
      dispatchId: string;
      attempt: number;
      eventCount: number;
      responseStatus?: number;
      latencyMs: number;
    } = {
      organizationId: payload.organizationId,
      endpointId: payload.endpointId,
      dispatchId: payload.batchId,
      attempt: context.attempt,
      eventCount: payload.envelopes.length,
      latencyMs,
    };
    if (result.status !== null) {
      attempt.responseStatus = result.status;
    }

    if (result.verdict === "success") {
      await this.deps.endpoints.recordDeliveryAttempt({
        ...attempt,
        outcome: "success",
      });

      return;
    }

    // A transport may return a failure verdict with nothing to say. One reason
    // stands in for both the log row and the throw, so a delivery-log reader
    // never sees a failed attempt with a blank reason column.
    const reason = result.error ?? "delivery failed";
    const response: { body: unknown; retryAfterMs?: number } = {
      body: result.body,
    };
    if (result.retryAfterMs !== undefined) {
      response.retryAfterMs = result.retryAfterMs;
    }

    await this.deps.endpoints.recordDeliveryAttempt({
      ...attempt,
      outcome: result.verdict,
      error: reason,
      response,
    });
    // The same classification just recorded, as the throw the dispatcher acts
    // on: it ladders retryables and dead-letters terminals immediately.
    const dispatchError: {
      message: string;
      retryable: boolean;
      retryAfterMs?: number;
    } = {
      message: `Webhook endpoint ${payload.endpointId}: ${reason}`,
      retryable: result.verdict === "retryable",
    };
    // Honour the receiver's backpressure on a retryable verdict. The queue
    // folds it into its backoff as a floor.
    if (result.verdict === "retryable" && result.retryAfterMs !== undefined) {
      dispatchError.retryAfterMs = result.retryAfterMs;
    }

    throw new DispatchError(dispatchError);
  }
}
