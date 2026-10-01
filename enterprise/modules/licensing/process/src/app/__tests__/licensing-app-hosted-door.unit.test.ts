import { BearerIdentity, RestHost, type RestIdentity } from "@langwatch/api/rest";
import { GatewayApi, GatewayInternalAuthenticationError } from "@langwatch/gateway-contract";
import { ResourceScope } from "@langwatch/process";
import { ScopedSecrets } from "@langwatch/secrets";
// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * @vitest-environment node
 * @see enterprise/modules/licensing/specs/licensing.feature
 */
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it, vi } from "vitest";

import { TEST_LICENSING_CONFIG } from "../../__tests__/testing.ts";
import { licensingProcessModule } from "../../licensing.module.ts";
import { LicensingInfrastructureService } from "../../services/licensing-infrastructure.service.ts";
import { connectHostedRest } from "../../transport/connect-hosted.rest.ts";

const SIGNED = "signed-with-the-gateway-secret";

/** The gateway's door as its Api hands it out: only a correctly signed call passes. */
const gatewayDoor: RestIdentity = {
  authenticate: () => {
    throw new GatewayInternalAuthenticationError("invalid_signature", "unsigned");
  },
  identify: ({ request }) => {
    if (request.headers.get("X-LangWatch-Gateway-Signature") !== SIGNED) {
      throw new GatewayInternalAuthenticationError("invalid_signature", "signature mismatch");
    }
    return {
      actor: null,
      scope: null,
      internal: { type: "internalSecret" as const, secretName: "LW_GATEWAY_INTERNAL_SECRET" },
    };
  },
};

async function hostedFamily() {
  const partial = LicensingInfrastructureService.create({ processName: "the api" });
  const unregistered = partial.unavailableRegistry();
  const findByVirtualKeyId = vi.fn().mockResolvedValue(null);
  const resources = new ResourceScope();
  const state = await licensingProcessModule.install({
    resources,
    config: TEST_LICENSING_CONFIG,
    members: {
      infrastructure: {
        ...partial.withoutMutation({
          licenses: {
            getOrganizationLicense: () => Promise.resolve({ licenseKey: null }),
            findOrganizationsWithLicense: () => Promise.resolve([]),
          },
        }),
        registry: {
          ...unregistered,
          repository: { ...unregistered.repository, findByVirtualKeyId },
        },
      },
      isSaas: true,
      serviceVersion: "test",
    },
    role: "api",
    secrets: new ScopedSecrets(async (_handle, build) => build(undefined)),
    resolve: (token) =>
      token === GatewayApi
        ? createApiFixture<GatewayApi>({ internalDoor: () => gatewayDoor })
        : createApiFixture<never>(),
  });
  const closed = BearerIdentity.create({ name: "unconfigured", token: undefined });
  const runtime = RestHost.create({
    identities: {
      project: closed,
      organization: closed,
      apiKey: closed,
      scimToken: closed,
      "instance-admin": closed,
      browser: closed,
    },
    bearers: () => closed,
    audit: { record: async () => undefined },
  });
  runtime.mount(connectHostedRest.router(), () => state.provided, { facts: state.facts });

  const call = (signature: string) =>
    runtime.app.request(
      new Request("http://api.test/api/internal/gateway/connect/instant-evals-classify", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "X-LangWatch-Gateway-Signature": signature,
        },
        body: JSON.stringify({
          virtual_key_id: "vk-unlicensed",
          organization_id: "org-acme",
          project_id: "",
          payload: { text: "the customer wrote in", questions: [] },
        }),
      }),
    );
  return { call, findByVirtualKeyId, close: () => resources.close() };
}

describe("the hosted Connect family behind the gateway's own door", () => {
  describe("given a hosted call whose signature the gateway does not accept", () => {
    /** @scenario "A hosted call with a bad signature is refused before any route runs" */
    it("answers 401 and never reads a licence", async () => {
      const family = await hostedFamily();

      try {
        const response = await family.call("forged");

        expect(response.status).toBe(401);
        await expect(response.json()).resolves.toMatchObject({ code: "permission_denied" });
        expect(family.findByVirtualKeyId).not.toHaveBeenCalled();
      } finally {
        await family.close();
      }
    });
  });

  describe("given a signed hosted call from a key no licence carries", () => {
    /** @scenario "A signed hosted call from a key without a licence is refused by its code" */
    it("passes the door and is refused as not entitled", async () => {
      const family = await hostedFamily();

      try {
        const response = await family.call(SIGNED);

        expect(response.status).toBe(403);
        await expect(response.json()).resolves.toMatchObject({
          code: "connect_service_not_entitled",
        });
        expect(family.findByVirtualKeyId).toHaveBeenCalledWith("vk-unlicensed");
      } finally {
        await family.close();
      }
    });
  });
});
