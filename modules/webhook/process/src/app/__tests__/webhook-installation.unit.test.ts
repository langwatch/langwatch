/**
 * @vitest-environment node
 * The feature installs: a memory-tier process gets a working `WebhookApi` over installer-built
 * repositories, with no repository class or tier named here.
 */
import type { EntitlementApi, Plan } from "@langwatch/entitlement-contract";
import { createApp } from "@langwatch/process";
import { memoryStores } from "@langwatch/process-stores";
import type { ProjectApi } from "@langwatch/project-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { WebhookApi } from "@langwatch/webhook-contract";
import { describe, expect, it } from "vitest";

import { webhookProcessModule } from "../../webhook.module.ts";

const ORGANIZATION_ID = "organization-1";

const entitledPlan: Plan = {
  planSource: "license",
  type: "enterprise",
  name: "Enterprise",
  free: false,
  maxMembers: 10,
  maxMembersLite: 10,
  maxMessagesPerMonth: 10,
  canPublish: true,
  webhookEndpointsEnabled: true,
  prices: { USD: 0, EUR: 0 },
};

function process(role: "api" | "worker", plan: Plan = entitledPlan) {
  return createApp({ role })
    .withModules([webhookProcessModule])
    .withConfig({
      webhook: {
        allowInsecureLocalUrls: false,
        allowAmbientAwsCredentials: false,
        isSaas: false,
        outboundProxy: {
          HTTPS_PROXY: undefined,
          https_proxy: undefined,
          HTTP_PROXY: undefined,
          http_proxy: undefined,
          NO_PROXY: undefined,
          no_proxy: undefined,
        },
      },
    })
    .withStores(memoryStores())
    .provide({
      entitlement: createApiFixture<EntitlementApi>({
        getActivePlan: async () => plan,
        requestBound: async () => 10,
      }),
      project: createApiFixture<ProjectApi>({ listIdsByOrganization: async () => [] }),
    });
}

describe("webhook app installation", () => {
  describe("given a process that boots the feature over memory", () => {
    it.each(["api", "worker"] as const)("installs a working app in the %s role", async (role) => {
      const runtime = await process(role).boot();

      try {
        const app = runtime.service(WebhookApi);

        expect(runtime.module(webhookProcessModule).provided).toBe(app);

        const { endpoint, secret } = await app.create({
          organizationId: ORGANIZATION_ID,
          url: "https://example.com/hooks/spend",
          enabledEvents: ["gateway.request.completed"],
        });

        expect(secret).not.toBe("");
        await expect(app.getAll({ organizationId: ORGANIZATION_ID })).resolves.toMatchObject([
          { id: endpoint.id },
        ]);
        await expect(app.getAll({ organizationId: "other-organization" })).resolves.toEqual([]);
      } finally {
        await runtime.stop();
      }
    });
  });

  describe("given an organization whose plan lacks webhook endpoints", () => {
    /** @scenario The plan gate answers on a deployment with no Enterprise governance application */
    it("refuses the gate as forbidden, naming the plan, with only entitlement composed", async () => {
      const runtime = await process("api", {
        ...entitledPlan,
        webhookEndpointsEnabled: false,
      }).boot();

      try {
        const error = await runtime
          .service(WebhookApi)
          .assertEndpointsEntitled(ORGANIZATION_ID)
          .catch((caught: unknown) => caught);

        expect(error).toMatchObject({
          code: "webhook_endpoints_not_entitled",
          httpStatus: 403,
          message: expect.stringContaining("plan"),
        });
      } finally {
        await runtime.stop();
      }
    });
  });

  describe("when the API process is asked for a test fire", () => {
    /** @scenario "A test fire from the API process dispatches through the delivery egress" */
    it("dispatches it through the delivery egress rather than refusing", async () => {
      const runtime = await process("api").boot();

      try {
        const app = runtime.service(WebhookApi);
        const { endpoint } = await app.create({
          organizationId: ORGANIZATION_ID,
          url: "https://10.0.0.1/hooks/spend",
          enabledEvents: ["gateway.request.completed"],
        });

        const result = await app.testFire({
          organizationId: ORGANIZATION_ID,
          endpointId: endpoint.id,
        });

        const log = await app.getDeliveries({
          organizationId: ORGANIZATION_ID,
          endpointId: endpoint.id,
        });

        // The egress fence refused the private address: the fire reached the real last hop.
        expect(result).toMatchObject({ delivered: false, responseStatus: null });
        expect(log.deliveries).toHaveLength(1);
        expect(log.deliveries[0]?.error).toContain(`Webhook endpoint ${endpoint.id} (test)`);
      } finally {
        await runtime.stop();
      }
    });
  });
  describe("when an SQS endpoint is test-fired over memory stores", () => {
    it("sends through the memory SQS channel, never real AWS", async () => {
      const runtime = await process("api").boot();

      try {
        const app = runtime.service(WebhookApi);
        const { endpoint } = await app.create({
          organizationId: ORGANIZATION_ID,
          destinationKind: "sqs",
          sqs: {
            queueUrl: "https://sqs.eu-west-1.amazonaws.com/123456789012/deliveries",
            roleArn: "arn:aws:iam::123456789012:role/webhook-delivery",
          },
          enabledEvents: ["gateway.request.completed"],
        });

        await expect(
          app.testFire({ organizationId: ORGANIZATION_ID, endpointId: endpoint.id }),
        ).resolves.toMatchObject({
          delivered: true,
          responseStatus: null,
          responseBody: "memory-sqs-1",
        });
      } finally {
        await runtime.stop();
      }
    });
  });
});
