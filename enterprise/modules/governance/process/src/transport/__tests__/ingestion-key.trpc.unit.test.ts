// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * @vitest-environment node
 * `ingestionKey.*` over the real tRPC runtime, pinned to main's wire
 * (platform/app/ee/governance/routers/ingestionKey.ts on origin/main).
 */
import { createApiFixture } from "@langwatch/api-fixture";
import type { GovernanceRestApi } from "@langwatch/enterprise-governance-contract";
import { describe, expect, it } from "vitest";

import { ingestionKeyTrpcTransport } from "../ingestion-key.trpc.ts";
import {
  governanceTrpcMembers,
  governanceTrpcRuntime,
  procedureKinds,
} from "./support/governance-trpc.fixture.ts";

const issued = {
  token: "ik-lw-abcdefghijkl",
  apiKeyId: "ak_2",
  prefix: "ik-lw-abcdef",
  sourceType: "cursor",
};

function mount() {
  const asked: string[] = [];
  const calls: unknown[] = [];
  const app = createApiFixture<GovernanceRestApi>({
    ingestionKeyList: async (input) => {
      calls.push(input);
      return [];
    },
    ingestionKeyInstall: async (input) => {
      calls.push(input);
      return issued;
    },
    ingestionKeyRotate: async (input) => {
      calls.push(input);
      return { ...issued, revokedCount: 1, revokedDeviceLabels: ["laptop"] };
    },
    ingestionKeyRevoke: async (input) => {
      calls.push(input);
    },
  });
  const router = governanceTrpcRuntime(governanceTrpcMembers({ permits: () => true, asked })).mount(
    ingestionKeyTrpcTransport,
    () => app,
  );
  return { router, asked, calls, caller: router.createCaller({ actor: { id: "user_1" } }) };
}

describe("the ingestionKey tRPC namespace", () => {
  it("serves main's four procedures with main's kinds", () => {
    expect(procedureKinds(mount().router._def.procedures)).toEqual({
      list: "query",
      install: "mutation",
      rotate: "mutation",
      revoke: "mutation",
    });
  });

  it("lists the caller's own keys under organization:view", async () => {
    const { caller, asked, calls } = mount();

    await expect(caller.list({ organizationId: "org_1" })).resolves.toEqual([]);
    expect(asked).toEqual(["organization:view"]);
    expect(calls).toEqual([{ organizationId: "org_1", userId: "user_1" }]);
  });

  it("installs for the caller with main's templateId resolved to the template", async () => {
    const { caller, calls } = mount();

    await expect(
      caller.install({ organizationId: "org_1", sourceType: "cursor", templateId: "tpl_1" }),
    ).resolves.toEqual(issued);
    expect(calls).toEqual([
      {
        userId: "user_1",
        organizationId: "org_1",
        sourceType: "cursor",
        ingestionTemplateId: "tpl_1",
      },
    ]);
  });

  it("rotates and answers how many keys died and where", async () => {
    const { caller } = mount();

    await expect(caller.rotate({ organizationId: "org_1", sourceType: "cursor" })).resolves.toEqual(
      {
        ...issued,
        revokedCount: 1,
        revokedDeviceLabels: ["laptop"],
      },
    );
  });

  it("revokes one of the caller's keys and answers main's success", async () => {
    const { caller, calls } = mount();

    await expect(caller.revoke({ organizationId: "org_1", apiKeyId: "ak_1" })).resolves.toEqual({
      success: true,
    });
    expect(calls).toEqual([{ organizationId: "org_1", apiKeyId: "ak_1", userId: "user_1" }]);
  });
});
