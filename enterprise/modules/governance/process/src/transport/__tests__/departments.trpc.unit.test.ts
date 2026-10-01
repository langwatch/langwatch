// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * @vitest-environment node
 * `departments.*` over the real tRPC runtime, pinned to main's wire
 * (platform/app/ee/governance/routers/departments.ts on origin/main).
 */
import { createApiFixture } from "@langwatch/api-fixture";
import { createTrpcRuntime, type TrpcRuntimeMembers } from "@langwatch/api/trpc";
import type { GovernanceRestApi } from "@langwatch/enterprise-governance-contract";
import { initTRPC } from "@trpc/server";
import { describe, expect, it } from "vitest";

import { departmentsTrpcTransport } from "../departments.trpc.ts";

type TestContext = { actor: { id: string } };

const department = {
  id: "dep_1",
  name: "Research",
  organizationId: "org_1",
  createdAt: new Date("2026-01-01T00:00:00Z"),
  updatedAt: new Date("2026-01-02T00:00:00Z"),
};

function members(asked: string[]): TrpcRuntimeMembers<TestContext> {
  return {
    identity: { caller: (ctx) => ({ actor: { type: "user", id: ctx.actor.id } }) },
    authorization: {
      forRequest: () => ({
        getDecision: async ({ permission }) => {
          asked.push(permission);
          return { permitted: permission === "governance:view", organizationRole: null };
        },
        getProjectAnyDecision: async () => ({ permitted: false, organizationRole: null }),
        checkScopeLineage: async () => ({ kind: "consistent" }),
      }),
    },
    denials: {
      membershipDisabled: () => new Error("membership disabled"),
      liteMemberRestricted: () => new Error("lite member"),
    },
    audit: { record: async () => {}, redact: ({ args }) => args, exempt: () => false },
    errors: {
      report: () => {},
      asError: (failure) => (failure instanceof Error ? failure : new Error(String(failure))),
      translate: () => undefined,
    },
  };
}

function mount() {
  const asked: string[] = [];
  const calls: unknown[] = [];
  const app = createApiFixture<GovernanceRestApi>({
    departmentList: async (input) => {
      calls.push(input);
      return [department];
    },
    departmentArchive: async (input) => {
      calls.push(input);
    },
  });
  const trpc = initTRPC.context<TestContext>().create();
  const router = createTrpcRuntime<TestContext>({
    root: trpc,
    procedure: trpc.procedure,
    members: members(asked),
  }).mount(departmentsTrpcTransport, () => app);

  return { router, asked, calls, caller: router.createCaller({ actor: { id: "user_1" } }) };
}

describe("the departments tRPC namespace", () => {
  describe("given the mounted router", () => {
    it("serves main's procedure names with main's query and mutation kinds", () => {
      const { router } = mount();
      const kinds = Object.fromEntries(
        Object.entries(router._def.procedures).map(([name, procedure]) => [
          name,
          (procedure as { _def: { type: string } })._def.type,
        ]),
      );

      expect(kinds).toEqual({
        list: "query",
        assignments: "query",
        create: "mutation",
        rename: "mutation",
        archive: "mutation",
        assignUser: "mutation",
        assignTeam: "mutation",
        assignProject: "mutation",
      });
    });
  });

  describe("given a caller holding governance:view", () => {
    it("lists the organization's departments under governance:view", async () => {
      const { caller, asked, calls } = mount();

      await expect(caller.list({ organizationId: "org_1" })).resolves.toEqual([department]);
      expect(asked).toEqual(["governance:view"]);
      expect(calls).toEqual([{ organizationId: "org_1" }]);
    });

    it("refuses archiving, which takes governance:manage", async () => {
      const { caller, asked, calls } = mount();

      await expect(caller.archive({ organizationId: "org_1", id: "dep_1" })).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
      expect(asked).toEqual(["governance:manage"]);
      expect(calls).toEqual([]);
    });
  });

  describe("given an empty department name", () => {
    it("refuses it before the application is reached, as main's min(1) did", async () => {
      const { caller, calls } = mount();

      await expect(caller.create({ organizationId: "org_1", name: "" })).rejects.toMatchObject({
        code: "BAD_REQUEST",
      });
      expect(calls).toEqual([]);
    });
  });
});
