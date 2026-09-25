// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * @vitest-environment node
 * `sessionPolicy.*` over the real tRPC runtime, pinned to main's wire
 * (platform/app/ee/governance/routers/sessionPolicy.ts on origin/main).
 */
import { createApiFixture } from "@langwatch/api-fixture";
import type { GovernanceRestApi } from "@langwatch/enterprise-governance-contract";
import { describe, expect, it } from "vitest";

import { sessionPolicyTrpcTransport } from "../session-policy.trpc.ts";
import {
  governanceTrpcMembers,
  governanceTrpcRuntime,
  procedureKinds,
} from "./support/governance-trpc.fixture.ts";

function mount(permits: (permission: string) => boolean = () => true) {
  const asked: string[] = [];
  const calls: unknown[] = [];
  const app = createApiFixture<GovernanceRestApi>({
    sessionPolicyGet: async (input) => {
      calls.push(input);
      return { maxSessionDurationDays: 0 };
    },
    sessionPolicySetMaxDuration: async (input) => {
      calls.push(input);
      return { ok: true, reapedSessions: 2 };
    },
  });
  const router = governanceTrpcRuntime(governanceTrpcMembers({ permits, asked })).mount(
    sessionPolicyTrpcTransport,
    () => app,
  );
  return { router, asked, calls, caller: router.createCaller({ actor: { id: "user_1" } }) };
}

describe("the sessionPolicy tRPC namespace", () => {
  it("serves main's two procedure names", () => {
    expect(procedureKinds(mount().router._def.procedures)).toEqual({
      get: "query",
      setMaxDuration: "mutation",
    });
  });

  it("reads under organization:view", async () => {
    const { caller, asked } = mount();

    await expect(caller.get({ organizationId: "org_1" })).resolves.toEqual({
      maxSessionDurationDays: 0,
    });
    expect(asked).toEqual(["organization:view"]);
  });

  it("writes under organization:manage and answers how many sessions it reaped", async () => {
    const { caller, asked, calls } = mount();

    await expect(
      caller.setMaxDuration({ organizationId: "org_1", maxSessionDurationDays: 7 }),
    ).resolves.toEqual({ ok: true, reapedSessions: 2 });
    expect(asked).toEqual(["organization:manage"]);
    expect(calls).toEqual([{ organizationId: "org_1", maxSessionDurationDays: 7 }]);
  });

  it("refuses a ceiling beyond main's 365 days before the application is reached", async () => {
    const { caller, calls } = mount();

    await expect(
      caller.setMaxDuration({ organizationId: "org_1", maxSessionDurationDays: 366 }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(calls).toEqual([]);
  });

  it("refuses a writer without organization:manage", async () => {
    const { caller, calls } = mount(() => false);

    await expect(
      caller.setMaxDuration({ organizationId: "org_1", maxSessionDurationDays: 7 }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(calls).toEqual([]);
  });
});
