/**
 * @see specs/webhooks/webhook-endpoints.feature
 * The `/api/webhooks/v1` entitlement gate on a deployment that composed no
 * Enterprise governance application, driven through the mounted family.
 */
import type { Plan } from "@langwatch/entitlement-contract";
import { requestTraceIds } from "@langwatch/api/rest";
import { describe, expect, it } from "vitest";

import { canonicalErrorFor } from "../../app/api-canonical-error.ts";
import { composeEnterpriseGovernanceApplication } from "../../features/enterprise/enterprise-governance.composition.ts";
import { composeApiWebhookApplication } from "../../features/enterprise/enterprise-webhook.composition.ts";
import { mountRestFamily, type MountedRestFamily } from "./support/rest-family.harness.ts";

/** A deployment that composed no Enterprise governance application at all. */
const uncomposedGovernance = () => composeEnterpriseGovernanceApplication(undefined);

function mountWebhooks(webhookEndpointsEnabled: boolean | undefined): MountedRestFamily {
  const webhooks = composeApiWebhookApplication({
    webhooks: uncomposedGovernance().webhooks,
    plans: {
      getActivePlan: async () => ({ webhookEndpointsEnabled }) as unknown as Plan,
    },
  });

  return mountRestFamily({
    packaged: { webhooks: () => webhooks },
    packagedPorts: {
      canonicalError: (error, c) => canonicalErrorFor(error, requestTraceIds(c)),
    },
  });
}

describe("given a deployment that composed no Enterprise governance application", () => {
  describe("when an organization whose plan lacks webhook endpoints calls the family", () => {
    /** @scenario "The plan gate answers on a deployment with no Enterprise governance application" */
    it("refuses as forbidden and names the plan", async () => {
      const response = await mountWebhooks(undefined).get("/api/webhooks/v1/endpoints");
      const body = (await response.json()) as { error: { code: string; message: string } };

      expect({
        status: response.status,
        code: body.error.code,
        message: body.error.message,
      }).toEqual({
        status: 403,
        code: "forbidden",
        message:
          "Webhook endpoints are an enterprise feature; this organization's plan does not include them.",
      });
    });
  });

  describe("when the organization's plan does carry webhook endpoints", () => {
    /** @scenario "The plan gate answers on a deployment with no Enterprise governance application" */
    it("passes the gate and refuses on the capability this deployment has not composed", async () => {
      const response = await mountWebhooks(true).get("/api/webhooks/v1/endpoints");

      expect(response.status).toBe(503);
    });
  });
});
