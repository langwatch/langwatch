// SPDX-License-Identifier: Apache-2.0

import { createHash } from "node:crypto";

import { Temporal } from "@langwatch/time";
import {
  eventMatches,
  type WebhookDeliveryRequest,
  type WebhookDeliveryRequestResult,
} from "@langwatch/webhook-contract";

import type { WebhookEndpointRepository } from "../repositories/webhook-endpoint.repository.ts";
import type { SendBatchPayload } from "../rules/webhook-delivery-contract.rules.ts";
import type { WebhookDeliveryProcessDeps } from "./webhook-delivery.service.ts";
import type { WebhookEndpointStreamService } from "./webhook-endpoint-stream.service.ts";

interface WebhookDeliveryRequestDeps {
  endpoints: Pick<WebhookEndpointRepository, "getById" | "getDestinationConfig">;
  getPlan: WebhookDeliveryProcessDeps["getPlan"];
  stream: Pick<WebhookEndpointStreamService, "flush">;
  now?: () => number;
}

/**
 * A producer's message for one endpoint (ADR-167 Decision 1), appended to the endpoint's stream in
 * webhook's own transaction; the stream's ladder, ledger and dead-letter do the rest. The inbox id
 * is the producer's key, so a retried intent converges on one append and one delivery id.
 */
export class WebhookDeliveryRequestService {
  private constructor(private readonly deps: WebhookDeliveryRequestDeps) {}

  static create(deps: WebhookDeliveryRequestDeps): WebhookDeliveryRequestService {
    return new WebhookDeliveryRequestService(deps);
  }

  /** The envelope id for a key: stable across every retry and redrive of the producer's intent. */
  static deliveryIdFor({
    source,
    idempotencyKey,
  }: {
    source: WebhookDeliveryRequest["source"];
    idempotencyKey: string;
  }): string {
    const digest = createHash("sha256").update(`${source.module}:${idempotencyKey}`).digest("hex");
    return `evt_${digest.slice(0, 32)}`;
  }

  async requestDelivery({
    organizationId,
    destinationId,
    message,
    source,
  }: WebhookDeliveryRequest): Promise<WebhookDeliveryRequestResult> {
    const endpoint = await this.deps.endpoints.getById({
      organizationId,
      endpointId: destinationId,
    });
    const deliveryId = WebhookDeliveryRequestService.deliveryIdFor({
      source,
      idempotencyKey: message.idempotencyKey,
    });
    if (endpoint.status !== "ACTIVE" || !eventMatches(endpoint.enabledEvents, message.type)) {
      return { deliveryId };
    }
    const plan = await this.deps.getPlan(organizationId);
    if (
      plan.webhookEndpointsEnabled !== true &&
      !(await this.isMigratedLegacyEndpoint({ organizationId, endpointId: endpoint.id }))
    ) {
      return { deliveryId };
    }

    const envelope: SendBatchPayload["envelopes"][number] = {
      id: deliveryId,
      type: message.type,
      created: Temporal.Instant.fromEpochMilliseconds((this.deps.now ?? Date.now)()).toString({
        smallestUnit: "millisecond",
      }),
      schema_version: "1",
      data: message.body,
    };
    await this.deps.stream.flush({
      organizationId,
      endpoint,
      append: envelope,
      sourceEventId: `request:${endpoint.id}:${deliveryId}`,
    });
    return { deliveryId };
  }

  /** W11-D1 (b): an endpoint governance migrated from an inline alert keeps main's delivery. */
  private async isMigratedLegacyEndpoint(input: {
    organizationId: string;
    endpointId: string;
  }): Promise<boolean> {
    const destination = await this.deps.endpoints.getDestinationConfig(input);
    return destination.kind === "http" && destination.signatureScheme === "legacy_sha256";
  }
}
