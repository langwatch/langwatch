// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * @vitest-environment node
 * `anomalyRules.*` over the real tRPC runtime, pinned to main's wire
 * (platform/app/ee/governance/routers/anomalyRules.ts on origin/main).
 */
import { createApiFixture } from "@langwatch/api-fixture";
import type { GovernanceRestApi } from "@langwatch/enterprise-governance-contract";
import { describe, expect, it } from "vitest";

import { anomalyRulesTrpcTransport } from "../anomaly-rules.trpc.ts";
import {
  governanceTrpcMembers,
  governanceTrpcRuntime,
  procedureKinds,
} from "./support/governance-trpc.fixture.ts";

function mount(permits: (permission: string) => boolean = () => true) {
  const asked: string[] = [];
  const calls: unknown[] = [];
  const app = createApiFixture<GovernanceRestApi>({
    anomalyRuleList: async (input, by) => {
      calls.push({ input, by });
      return [];
    },
  });
  const router = governanceTrpcRuntime(governanceTrpcMembers({ permits, asked })).mount(
    anomalyRulesTrpcTransport,
    () => app,
  );
  return { router, asked, calls, caller: router.createCaller({ actor: { id: "user_1" } }) };
}

describe("the anomalyRules tRPC namespace", () => {
  it("serves main's procedure names with main's query and mutation kinds", () => {
    expect(procedureKinds(mount().router._def.procedures)).toEqual({
      list: "query",
      get: "query",
      create: "mutation",
      update: "mutation",
      archive: "mutation",
    });
  });

  it("lists under anomalyRules:view, acting as the signed-in person", async () => {
    const { caller, asked, calls } = mount();

    await expect(caller.list({ organizationId: "org_1" })).resolves.toEqual([]);
    expect(asked).toEqual(["anomalyRules:view"]);
    expect(calls).toEqual([
      { input: { organizationId: "org_1" }, by: expect.objectContaining({ id: "user_1" }) },
    ]);
  });

  it("carries an impersonating operator through to the application's plan check", async () => {
    const { router, calls } = mount();
    const caller = router.createCaller({ actor: { id: "user_1", impersonatorId: "staff_1" } });

    await caller.list({ organizationId: "org_1" });

    expect(calls).toEqual([
      {
        input: { organizationId: "org_1" },
        by: expect.objectContaining({ id: "user_1", impersonatorId: "staff_1" }),
      },
    ]);
  });

  it("refuses a create without anomalyRules:manage before the application is reached", async () => {
    const { caller, calls } = mount((permission) => permission === "anomalyRules:view");

    await expect(
      caller.create({
        organizationId: "org_1",
        name: "Spike",
        severity: "warning",
        ruleType: "spend_spike",
        scope: "organization",
        scopeId: "org_1",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(calls).toEqual([]);
  });
});
