import type { WebhookApi } from "@langwatch/webhook-contract";

import type { WebhookEndpointRepository } from "../repositories/webhook-endpoint.repository.ts";
import {
  assertDestinationUnchanged,
  assertValidDeliveryControls,
  assertValidDestinationInput,
  assertValidEvents,
  assertValidUrl,
  type WebhookEndpointConfiguration,
} from "../rules/webhook-endpoint-policy.rules.ts";

type WebhookEndpointDeps = Readonly<{
  endpoints: Pick<WebhookEndpointRepository, "create" | "getById" | "update">;
  configuration: WebhookEndpointConfiguration;
}>;

/** Endpoint saves: the endpoint policy decides what may be stored, the repository stores it. */
export class WebhookEndpointService {
  static create(deps: WebhookEndpointDeps): WebhookEndpointService {
    return new WebhookEndpointService(deps);
  }

  private constructor(private readonly deps: WebhookEndpointDeps) {}

  create: WebhookApi["create"] = async (input) => {
    const { endpoints, configuration } = this.deps;
    const destinationKind = input.destinationKind ?? "http";
    assertValidDestinationInput({ ...input, destinationKind }, configuration);
    assertValidEvents(input.enabledEvents);
    assertValidDeliveryControls(input);
    return endpoints.create(input);
  };

  update: WebhookApi["update"] = async (input) => {
    const { endpoints, configuration } = this.deps;
    const current = await endpoints.getById(input);
    assertDestinationUnchanged({ currentKind: current.destinationKind, params: input });
    if (input.url !== undefined) assertValidUrl(input.url, configuration);
    if (input.enabledEvents !== undefined) assertValidEvents(input.enabledEvents);
    assertValidDeliveryControls(input);
    return endpoints.update(input);
  };
}
