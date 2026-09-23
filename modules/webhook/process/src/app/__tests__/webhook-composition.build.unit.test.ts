/**
 * The webhook process composition: what `WebhookApp.create` derives from its
 * one peer dependency (`EntitlementApi`).
 * @vitest-environment node
 */
import type { EntitlementApi, Plan } from "@langwatch/entitlement-contract";
import {
  WebhookDispatchUnavailableError,
  WebhookEndpointsNotEntitledError,
} from "@langwatch/webhook-contract";
import { describe, expect, it } from "vitest";

import { buildWebhookComposition } from "../webhook-composition.build.ts";

const plan = (webhookEndpointsEnabled: boolean): Plan => ({
  planSource: "license",
  type: "enterprise",
  name: "Enterprise",
  free: false,
  maxMembers: 10,
  maxMembersLite: 10,
  maxMessagesPerMonth: 10,
  canPublish: true,
  webhookEndpointsEnabled,
  prices: { USD: 0, EUR: 0 },
});

class FixedEntitlement implements Pick<EntitlementApi, "getActivePlan"> {
  constructor(private readonly activePlan: Plan) {}

  getActivePlan(): Promise<Plan> {
    return Promise.resolve(this.activePlan);
  }
}

describe("buildWebhookComposition", () => {
  describe("given the process's entitlement peer", () => {
    it("grants when the organization's plan carries webhook endpoints", async () => {
      const built = buildWebhookComposition({
        entitlement: new FixedEntitlement(plan(true)),
      });

      await expect(built.assertEndpointsEntitled("org-1")).resolves.toBeUndefined();
    });

    it("wires the entitlement check through the shared plan gate", async () => {
      const built = buildWebhookComposition({
        entitlement: new FixedEntitlement(plan(false)),
      });

      await expect(built.assertEndpointsEntitled("org-1")).rejects.toBeInstanceOf(
        WebhookEndpointsNotEntitledError,
      );
    });
  });

  describe("when a test fire asks this process to dispatch", () => {
    /** @scenario "A test fire from the interactive process refuses by name" */
    it("refuses by name instead of crashing on an unsupplied function", async () => {
      const built = buildWebhookComposition({
        entitlement: new FixedEntitlement(plan(true)),
      });

      await expect(
        built.dispatch({
          destination: { kind: "http", url: "https://example.com" },
          organizationId: "org-1",
          endpointId: "whep_1",
          body: "{}",
          batchId: "batch-1",
          attempt: 1,
          signingSecrets: ["whsec_1"],
          isTestFire: true,
        }),
      ).rejects.toBeInstanceOf(WebhookDispatchUnavailableError);
    });
  });
});
