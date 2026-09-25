// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * @vitest-environment node
 * `routingPolicy.*` over the real tRPC runtime, pinned to main's wire
 * (platform/app/src/server/api/routers/routingPolicies.ts on origin/main).
 */
import { createApiFixture } from "@langwatch/api-fixture";
import type { EnterpriseGatewayApi } from "@langwatch/enterprise-gateway-contract";
import { describe, expect, it } from "vitest";

import { routingPolicyTrpcTransport } from "../routing-policy.trpc.ts";
import {
  gatewayTrpcMembers,
  gatewayTrpcRuntime,
  procedureKinds,
} from "./support/gateway-trpc.fixture.ts";

function mount(permits: (permission: string) => boolean = () => true) {
  const asked: string[] = [];
  const calls: unknown[] = [];
  const app = createApiFixture<EnterpriseGatewayApi>({
    listRoutingPolicies: async (input) => {
      calls.push(input);
      return [];
    },
    deleteRoutingPolicy: async (input) => {
      calls.push(input);
    },
    routingPolicyTierSuggestions: (input) => {
      calls.push(input);
      return [{ modelId: "openai/gpt-5", name: "GPT-5", provider: "openai", recommended: true }];
    },
  });
  const router = gatewayTrpcRuntime(gatewayTrpcMembers({ permits, asked })).mount(
    routingPolicyTrpcTransport,
    () => app,
  );
  return { router, asked, calls, caller: router.createCaller({ actor: { id: "user_1" } }) };
}

describe("the routingPolicy tRPC namespace", () => {
  it("serves main's procedure names with main's kinds", () => {
    expect(procedureKinds(mount().router._def.procedures)).toEqual({
      list: "query",
      get: "query",
      tierSuggestions: "query",
      create: "mutation",
      update: "mutation",
      setDefault: "mutation",
      delete: "mutation",
    });
  });

  it("lists under routingPolicies:view", async () => {
    const { caller, asked, calls } = mount();

    await caller.list({ organizationId: "org_1" });

    expect(asked).toEqual(["routingPolicies:view"]);
    expect(calls).toEqual([{ organizationId: "org_1" }]);
  });

  it("suggests tier targets under routingPolicies:view, defaulting the bound providers", async () => {
    const { caller, asked, calls } = mount();

    await expect(
      caller.tierSuggestions({ organizationId: "org_1", tier: "fast" }),
    ).resolves.toEqual([
      { modelId: "openai/gpt-5", name: "GPT-5", provider: "openai", recommended: true },
    ]);
    expect(asked).toEqual(["routingPolicies:view"]);
    expect(calls).toEqual([{ tier: "fast", boundProviderTypes: [] }]);
  });

  it("deletes under routingPolicies:manage and answers main's acknowledgement", async () => {
    const { caller, asked } = mount();

    await expect(caller.delete({ organizationId: "org_1", id: "rp_1" })).resolves.toEqual({
      ok: true,
    });
    expect(asked).toEqual(["routingPolicies:manage"]);
  });

  it("refuses a policy with no provider before the application is reached", async () => {
    const { caller, calls } = mount();

    await expect(
      caller.create({
        organizationId: "org_1",
        scopes: [{ scopeType: "ORGANIZATION", scopeId: "org_1" }],
        name: "Default",
        modelProviderIds: [],
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(calls).toEqual([]);
  });
});
