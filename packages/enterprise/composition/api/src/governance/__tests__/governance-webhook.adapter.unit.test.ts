// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { describe, expect, it, vi } from "vitest";
import type { WebhookEndpointView } from "@langwatch/enterprise-webhook-contract";
import type { WebhookDeliveryProcessDeps } from "@langwatch/enterprise-webhook-server";
import { AppGovernanceWebhookPort } from "../governance-webhook.adapter";

function endpoint(
  overrides: Partial<WebhookEndpointView> & { id: string; enabledEvents: string[] },
): WebhookEndpointView {
  return {
    organizationId: "org_1",
    destinationKind: "url",
    url: "https://example.com/hooks",
    sqs: null,
    status: "ACTIVE",
    disabledReason: null,
    disabledAt: null,
    failingSince: null,
    lastSuccessAt: null,
    lastFailureAt: null,
    maxBatchSize: 10,
    maxBatchDelayMs: 1000,
    maxInFlight: 4,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as WebhookEndpointView;
}

function harness(endpoints: WebhookEndpointView[]) {
  const deps = {
    endpoints: {
      getActiveByOrganization: vi.fn(async () => endpoints),
    },
  } as unknown as WebhookDeliveryProcessDeps;
  return AppGovernanceWebhookPort.create(deps);
}

describe("governance webhook delivery fan-out", () => {
  /** @scenario Governance events only reach endpoints subscribed to their types */
  it("delivers to lifecycle and family subscriptions, never spend-only ones", async () => {
    const port = harness([
      endpoint({ id: "ep_spend", enabledEvents: ["gateway.request.completed"] }),
      endpoint({ id: "ep_lifecycle", enabledEvents: ["gateway.virtual_key.disabled"] }),
      endpoint({ id: "ep_family", enabledEvents: ["gateway.*"] }),
    ]);

    const ids = await port.activeEndpointIds({
      organizationId: "org_1",
      eventType: "gateway.virtual_key.disabled",
    });

    expect(ids).toEqual(["ep_lifecycle", "ep_family"]);
  });
});
