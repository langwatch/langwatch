// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * @vitest-environment node
 * Who reaches the directory-sync oversight, and what a refusal says (ADR-122):
 * a plain not-found, so a cross-customer surface does not confirm itself to a
 * prober. enterprise/modules/scim/specs/scim-reconciliation-surfaces.feature
 */
import {
  createTrpcRuntime,
  type TrpcProcedureFactory,
  type TrpcRouterMount,
  type TrpcRuntimeMembers,
} from "@langwatch/api/trpc";
import { testAuthorizeDefaults } from "@langwatch/test-harness/trpc-members";
import { initTRPC, TRPCError } from "@trpc/server";
import { describe, expect, it } from "vitest";

import { MemoryScimRepository } from "../../repositories/memory/memory.scim.repository.ts";
import { ScimOversightService } from "../../services/scim-oversight.service.ts";
import { scimOversightTrpcTransport } from "../scim-oversight.trpc.ts";
import { scimTestApp } from "./support/scim-app.fixture.ts";

type TestContext = { actor: { id: string } };

const OPERATOR = "user_ops";
const CONNECTION = "acme-okta";

function testPorts(): TrpcRuntimeMembers<TestContext> {
  return {
    identity: { caller: (ctx) => ({ actor: { type: "user", id: ctx.actor.id } }) },
    authorization: {
      forRequest: () => ({
        ...testAuthorizeDefaults,
        getDecision: async () => ({ permitted: false, organizationRole: null }),
        getProjectAnyDecision: async () => ({ permitted: false, organizationRole: null }),
        checkScopeLineage: async () => ({ kind: "consistent" }),
        getPlatformDecision: async ({ userId, permission }) => ({
          permitted: permission === "ops:manage" && userId === OPERATOR,
        }),
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

/** Every procedure the declaration binds, with the access it asked of the door. */
function boundAccess(): Record<string, string> {
  const declared: Record<string, string> = {};
  const runtime: TrpcProcedureFactory<object> = {
    procedure: ({ procedure, access }) => {
      declared[procedure] =
        access.kind === "permission-platform"
          ? `${access.kind}:${access.permission}:${access.refusal}`
          : access.kind;
      return {};
    },
    router: (record) => record,
  };
  (scimOversightTrpcTransport as { router: TrpcRouterMount<never, never> }).router(runtime, () => {
    throw new Error("the wire table never resolves an application");
  });
  return declared;
}

function mount(userId: string) {
  const acts: string[] = [];
  const oversight = ScimOversightService.create({
    syncs: {
      listForOperator: async () => {
        acts.push("listed");
        return { syncs: [], total: 0 };
      },
      findForOperator: async () => [],
    },
    organizations: { findOrganizationNames: async () => [] },
    identities: MemoryScimRepository.create(),
    lifecycle: { applyRedriven: async () => undefined },
    deprovision: { removeAccess: async () => ({ ownedApiKeys: [], personalTeams: [] }) },
  });
  const { app, audited } = scimTestApp({
    oversight,
    platformOperators: [OPERATOR],
  });
  const trpc = initTRPC.context<TestContext>().create();
  const router = createTrpcRuntime<TestContext>({
    root: trpc,
    procedure: trpc.procedure,
    members: testPorts(),
  }).mount(scimOversightTrpcTransport, () => app);

  return { acts, audited, caller: router.createCaller({ actor: { id: userId } }) };
}

describe("the admin directory sync surface", () => {
  describe("given the route declaration", () => {
    /** @scenario "The surface is refused without platform operator access" */
    it("asks ops:manage at the platform tier of the door on every procedure and hides the surface", () => {
      const declared = Object.values(boundAccess());

      expect(declared).toHaveLength(4);
      expect(new Set(declared)).toEqual(new Set(["permission-platform:ops:manage:hidden"]));
    });
  });

  describe("given a signed-in user who is not a platform operator", () => {
    /** @scenario "The surface is refused without platform operator access" */
    it("refuses every procedure with a plain not-found and runs nothing", async () => {
      const { acts, audited, caller } = mount("user_customer");

      const denials = await Promise.all([
        caller.getAll({ page: 0, pageSize: 25 }).catch((error: unknown) => error),
        caller.getById({ connectionId: CONNECTION }).catch((error: unknown) => error),
        caller.directoryIdentities({ connectionId: CONNECTION }).catch((error: unknown) => error),
        caller
          .redriveRetiredApply({ connectionId: CONNECTION, retiredAtMs: 1 })
          .catch((error: unknown) => error),
      ]);

      for (const denial of denials) {
        expect(denial).toBeInstanceOf(TRPCError);
        expect(denial).toMatchObject({ code: "NOT_FOUND" });
      }
      expect(acts).toEqual([]);
      expect(audited).toEqual([]);
    });
  });

  describe("given a platform operator", () => {
    it("reaches the surface and records the read with the operator on it first", async () => {
      const { acts, audited, caller } = mount(OPERATOR);

      await expect(caller.getAll({ page: 0, pageSize: 25 })).resolves.toEqual({
        syncs: [],
        total: 0,
      });
      expect(audited).toEqual([
        expect.objectContaining({ userId: OPERATOR, action: "scimOversight.getAll" }),
      ]);
      expect(acts).toEqual(["listed"]);
      await expect(caller.getById({ connectionId: CONNECTION })).resolves.toBeNull();
    });
  });
});
