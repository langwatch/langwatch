// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * @vitest-environment node
 * `personalVirtualKeys.*` over the real tRPC runtime, pinned to main's wire
 * (platform/app/src/server/api/routers/personalVirtualKeys.ts on origin/main).
 */
import { createApiFixture } from "@langwatch/api-fixture";
import type { EnterpriseGatewayApi } from "@langwatch/enterprise-gateway-contract";
import { describe, expect, it } from "vitest";

import { personalVirtualKeysTrpcTransport } from "../personal-virtual-keys.trpc.ts";
import {
  gatewayTrpcMembers,
  gatewayTrpcRuntime,
  procedureKinds,
} from "./support/gateway-trpc.fixture.ts";

const minted = {
  id: "vk_1",
  label: "laptop",
  secret: "lw_vk_secret",
  baseUrl: "https://gw.example",
  displayPrefix: "lw_vk_ab",
  routingPolicyId: null,
};

function mount() {
  const asked: string[] = [];
  const calls: unknown[] = [];
  const app = createApiFixture<EnterpriseGatewayApi>({
    listPersonalVirtualKeys: async (input) => {
      calls.push({ input });
      return [];
    },
    issuePersonalVirtualKey: async (input) => {
      calls.push({ input });
      return minted;
    },
    revokePersonalVirtualKey: async (input) => {
      calls.push({ input });
    },
  });
  const router = gatewayTrpcRuntime(gatewayTrpcMembers({ permits: () => true, asked })).mount(
    personalVirtualKeysTrpcTransport,
    () => app,
  );
  return { router, asked, calls, caller: router.createCaller({ actor: { id: "user_1" } }) };
}

describe("the personalVirtualKeys tRPC namespace", () => {
  it("serves main's procedure names with main's kinds", () => {
    expect(procedureKinds(mount().router._def.procedures)).toEqual({
      list: "query",
      issuePersonal: "mutation",
      revokePersonal: "mutation",
    });
  });

  it("lists without an organization permission, leaving membership to the application", async () => {
    const { caller, asked, calls } = mount();

    await caller.list({ organizationId: "org_1", targetUserId: "user_2" });

    expect(asked).toEqual([]);
    expect(calls).toEqual([
      { input: { organizationId: "org_1", targetUserId: "user_2", actorUserId: "user_1" } },
    ]);
  });

  it("issues under organization:view and answers main's minted key", async () => {
    const { caller, asked } = mount();

    await expect(
      caller.issuePersonal({ organizationId: "org_1", label: "laptop" }),
    ).resolves.toEqual(minted);
    expect(asked).toEqual(["organization:view"]);
  });

  it("refuses a label with spaces before the application is reached, as main's regex did", async () => {
    const { caller, calls } = mount();

    await expect(
      caller.issuePersonal({ organizationId: "org_1", label: "my laptop" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(calls).toEqual([]);
  });

  it("revokes and answers main's acknowledgement", async () => {
    const { caller } = mount();

    await expect(caller.revokePersonal({ organizationId: "org_1", id: "vk_1" })).resolves.toEqual({
      ok: true,
    });
  });
});
