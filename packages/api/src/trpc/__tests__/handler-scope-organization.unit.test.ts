/**
 * The organization holding the scope the door asked at, handed to the handler (lineage D1).
 * Spec: packages/api/specs/trpc-framework.feature.
 */
import { defineTrpcContract, moduleApi } from "@langwatch/module";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { authorizeDefaults } from "../../__tests__/api-double.ts";
import { permissionBy } from "../../access/input-permission.ts";
import {
  createTrpcRuntime,
  defineTrpcRouter,
  TrpcRootDefinition,
  type TrpcRuntimeMembers,
} from "../runtime.ts";

interface ScopeApi {
  seen(input: unknown): Promise<unknown>;
}

const ScopeApi = moduleApi<ScopeApi>()("data-retention");

const scopeOutput = z.object({ scope: z.unknown() });

const scopeContract = defineTrpcContract("scopeProbe")
  .mutation("byScope")
  .withInput(
    z.object({
      scope: z.object({
        scopeType: z.enum(["ORGANIZATION", "TEAM", "PROJECT"]),
        scopeId: z.string(),
      }),
    }),
  )
  .withOutput(scopeOutput)
  .query("unscoped")
  .withInput(z.object({ flag: z.string() }))
  .withOutput(scopeOutput)
  .build();

type ProbeContext = { actor: { id: string } };

const probeRoot = TrpcRootDefinition.forContext<ProbeContext>().create({});

const BY_SCOPE_TYPE = permissionBy({
  field: "scope.scopeType",
  map: {
    ORGANIZATION: {
      permission: "organization:manage",
      tier: "organization",
      field: "scope.scopeId",
    },
    TEAM: { permission: "team:manage", tier: "team", field: "scope.scopeId" },
    PROJECT: { permission: "project:update", tier: "project", field: "scope.scopeId" },
  },
});

const HOLDERS: Record<string, string> = { "project-1": "org-1", "team-1": "org-2" };

function probe({ resolves }: { resolves: boolean }) {
  const asked: { tier: string; id: string }[] = [];
  const members: TrpcRuntimeMembers<ProbeContext> = {
    identity: { caller: (ctx) => ({ actor: { type: "user", id: ctx.actor.id } }) },
    authorization: {
      forRequest: () => ({
        ...authorizeDefaults,
        getDecision: async () => ({ permitted: true, organizationRole: null }),
        getProjectAnyDecision: async () => ({ permitted: true, organizationRole: null }),
        checkScopeLineage: async () => ({ kind: "consistent" }),
        ...(resolves
          ? {
              organizationOf: async (scope: { tier: string; id: string }) => {
                asked.push(scope);

                return HOLDERS[scope.id] ?? null;
              },
            }
          : {}),
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

  const router = defineTrpcRouter(ScopeApi, scopeContract)
    .procedure("byScope")
    .withPermission(BY_SCOPE_TYPE)
    .handle(async ({ scope }) => ({ scope }))
    .procedure("unscoped")
    .serviceAuthorized({ reason: "a probe that proves no scope", permissions: ["project:view"] })
    .handle(async ({ scope }) => ({ scope }))
    .build();

  const runtime = createTrpcRuntime({ root: probeRoot, procedure: probeRoot.procedure, members });
  const call = runtime
    .mount(router, () => ({ seen: async () => null }))
    .createCaller({ actor: { id: "user-1" } });

  return { asked, call };
}

describe("a handler's scope", () => {
  describe("when the door asked at a project", () => {
    /** @scenario "A procedure's handler is handed the organization holding the scope its door asked at" */
    it("names the project and the organization holding it, asked of authz once", async () => {
      const { asked, call } = probe({ resolves: true });

      await expect(
        call.byScope({ scope: { scopeType: "PROJECT", scopeId: "project-1" } }),
      ).resolves.toEqual({
        scope: { tier: "project", id: "project-1", organizationId: "org-1", kind: "application" },
      });
      expect(asked).toEqual([{ tier: "project", id: "project-1" }]);
    });
  });

  describe("when the door asked at a team", () => {
    /** @scenario "A procedure's handler is handed the organization holding the scope its door asked at" */
    it("names the team and the organization holding it", async () => {
      const { call } = probe({ resolves: true });

      await expect(
        call.byScope({ scope: { scopeType: "TEAM", scopeId: "team-1" } }),
      ).resolves.toEqual({ scope: { tier: "team", id: "team-1", organizationId: "org-2" } });
    });
  });

  describe("when the door asked at an organization", () => {
    /** @scenario "A procedure's handler is handed the organization holding the scope its door asked at" */
    it("names the organization as its own holder without asking authz", async () => {
      const { asked, call } = probe({ resolves: true });

      await expect(
        call.byScope({ scope: { scopeType: "ORGANIZATION", scopeId: "org-3" } }),
      ).resolves.toEqual({
        scope: { tier: "organization", id: "org-3", organizationId: "org-3" },
      });
      expect(asked).toEqual([]);
    });
  });

  describe("when the door cannot say which organization holds the scope", () => {
    /** @scenario "A procedure's handler is handed the organization holding the scope its door asked at" */
    it("hands a null organization rather than a guess", async () => {
      const { call } = probe({ resolves: false });

      await expect(
        call.byScope({ scope: { scopeType: "PROJECT", scopeId: "project-1" } }),
      ).resolves.toEqual({
        scope: { tier: "project", id: "project-1", organizationId: null, kind: "application" },
      });
    });
  });

  describe("when the door resolved no scope", () => {
    /** @scenario "A procedure's handler is handed the organization holding the scope its door asked at" */
    it("hands none", async () => {
      const { asked, call } = probe({ resolves: true });

      await expect(call.unscoped({ flag: "x" })).resolves.toEqual({ scope: null });
      expect(asked).toEqual([]);
    });
  });
});
