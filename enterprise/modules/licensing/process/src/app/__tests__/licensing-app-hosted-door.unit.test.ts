import type { RestIdentity } from "@langwatch/api/hosting";
import { BearerIdentity, RestHost } from "@langwatch/api/rest";
import { GatewayApi, GatewayInternalAuthenticationError } from "@langwatch/gateway-contract";
import { InstantEvalApi } from "@langwatch/instant-eval-contract";
import { ResourceScope } from "@langwatch/process";
import { ScopedSecrets } from "@langwatch/secrets";
// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * @vitest-environment node
 * @see enterprise/modules/licensing/specs/licensing.feature
 */
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { Temporal } from "@langwatch/time";
import { describe, expect, it, vi } from "vitest";

import { TEST_LICENSING_CONFIG } from "../../__tests__/testing.ts";
import { licensingProcessModule } from "../../licensing.module.ts";
import type { IssuedLicenseRecord } from "../../repositories/issued-license.repository.ts";
import { MemoryIssuedLicenseRepository } from "../../repositories/memory/memory.issued-license.repository.ts";
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

const AT = Temporal.Instant.from("2026-01-01T00:00:00.000Z");

/** A licence of the organization that carries the instant-eval service on a managed key. */
function licenceOnManagedKey(): IssuedLicenseRecord {
  return {
    id: "license-1",
    licenseId: "lic-1",
    tokenHash: "hash-1",
    organizationId: "org-acme",
    organizationName: "ACME",
    email: "ops@example.com",
    planType: "ENTERPRISE",
    maxMembers: 50,
    maxMembersLite: 0,
    issuedAt: AT,
    expiresAt: Temporal.Instant.from("2099-01-01T00:00:00.000Z"),
    source: "BACKOFFICE",
    issuedById: "operator-1",
    revokedAt: null,
    revokedById: null,
    revokedReason: null,
    supersededAt: null,
    replacesId: null,
    pendingDeliveryLicense: null,
    services: ["instant_evals"],
    seatRateCents: null,
    seatCurrency: null,
    commitUsdCents: 100_000,
    overageEnabled: false,
    overageMaxUsdCents: null,
    instanceId: "instance-1",
    instanceBoundAt: AT,
    lastSyncAt: null,
    lastSyncVersion: null,
    reportedMembers: null,
    reportedMembersLite: null,
    virtualKeyId: "vk-unlicensed",
    seatsRaisedFrom: null,
    createdAt: AT,
    updatedAt: AT,
  };
}

async function hostedFamily(
  options: { licence?: IssuedLicenseRecord; instantEval?: InstantEvalApi } = {},
) {
  // The memory tier's own licence rows: none carries the calling key, unless the test names one.
  const findByVirtualKeyId = vi
    .spyOn(MemoryIssuedLicenseRepository.prototype, "findByVirtualKeyId")
    .mockResolvedValue(options.licence ?? null);
  const resources = new ResourceScope();
  const state = await licensingProcessModule.install({
    resources,
    config: { ...TEST_LICENSING_CONFIG, isSaas: true },
    members: {},
    repositorySelection: { tier: "memory", members: {} },
    role: "api",
    secrets: new ScopedSecrets(async (_handle, build) => build(undefined)),
    resolve: (token) => {
      if (token === GatewayApi) {
        return createApiFixture<GatewayApi>({ internalDoor: () => gatewayDoor });
      }
      if (token === InstantEvalApi && options.instantEval) return options.instantEval;
      return createApiFixture<never>();
    },
  });
  const closed = BearerIdentity.create({ name: "unconfigured", token: undefined });
  const runtime = RestHost.create({
    identities: {
      project: closed,
      organization: closed,
      api_key: closed,
      scim_token: closed,
      instance_admin: closed,
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
          payload: {
            text: "the customer wrote in",
            questions: [{ id: "q1", kind: "boolean", instructions: "Is it polite?" }],
          },
        }),
      }),
    );
  return {
    call,
    findByVirtualKeyId,
    close: async () => {
      findByVirtualKeyId.mockRestore();
      await resources.close();
    },
  };
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

  describe("given LangWatch Cloud judges hosted calls with a judge at its own rate and markup", () => {
    /** @scenario A hosted judgement is priced at the rate of the judge that made it */
    it("tells the customer the judge's price and records the judge's cost under the calling key", async () => {
      const recorded: Parameters<InstantEvalApi["recordSpendForHostedCalls"]>[0][] = [];
      const priced: number[] = [];
      const instantEval = createApiFixture<InstantEvalApi>({
        classify: async () => ({ verdicts: [], inputTokens: 2_000_000, isTextTruncated: false }),
        priceOf: ({ inputTokens }) => {
          priced.push(inputTokens);
          const costUsd = (inputTokens / 1_000_000) * 0.5;
          return { costUsd, priceUsd: costUsd * 1.4 };
        },
        recordSpendForHostedCalls: async (entry) => {
          recorded.push(entry);
        },
      });
      const family = await hostedFamily({ licence: licenceOnManagedKey(), instantEval });

      let response: Response;
      try {
        response = await family.call(SIGNED);
      } finally {
        // Closing the install writes the spend the buffer still holds.
        await family.close();
      }

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({ charged_usd: 1.4 });
      expect(priced).toEqual([2_000_000]);
      expect(recorded).toHaveLength(1);
      expect(recorded[0]).toMatchObject({
        virtualKeyId: "vk-unlicensed",
        inputTokens: 2_000_000,
        costUsd: 1,
        priceUsd: 1.4,
      });
    });
  });
});
