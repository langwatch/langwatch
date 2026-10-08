/**
 * The three retention scope writes through the real door: the permission is asked on the target
 * before data retention runs, and data retention refuses a target outside the named organization.
 * Spec: modules/data-retention/specs/data-retention-scope-writes.feature
 */
import {
  createTrpcRuntime,
  TrpcRootDefinition,
  type TrpcRuntimeMembers,
} from "@langwatch/api/trpc";
import type { EntitlementApi } from "@langwatch/entitlement-contract";
import { describe, expect, it } from "vitest";

import {
  MemoryRetentionDirectory,
  createDataRetentionTestApp,
  createDataRetentionTestEntitlement,
  retentionTestGraph,
  retentionTestScopeRow,
} from "../../app/__tests__/data-retention.fixture.ts";
import type { DataRetentionModule } from "../../app/data-retention.app.ts";
import { MemoryDataRetentionProjectScopeRepository } from "../../repositories/memory/memory.data-retention-project-scope.repository.ts";
import { MemoryDataRetentionRepositories } from "../../repositories/memory/memory.data-retention.repositories.ts";
import { dataRetentionTrpcTransport } from "../data-retention.trpc.ts";

type DoorContext = { actor: { id: string } };
type Asked = { permission: string; scope: { tier: string; id: string } };

const ACME = retentionTestGraph.organizationId ?? "organization-1";
const PLATFORM = retentionTestGraph.teamId;
const WEB_APP = retentionTestGraph.projectId;
const GLOBEX = { ...retentionTestGraph, organizationId: "organization-globex", teamId: "team-ops" };
const root = TrpcRootDefinition.forContext<DoorContext>().create({});

function retentionApp(entitlement?: EntitlementApi): DataRetentionModule {
  return createDataRetentionTestApp({
    repositories: {
      ...MemoryDataRetentionRepositories.create(),
      directory: MemoryRetentionDirectory.create(),
      projectScopes: MemoryDataRetentionProjectScopeRepository.create({
        rows: [retentionTestScopeRow(WEB_APP), retentionTestScopeRow("project-billing", GLOBEX)],
      }),
    },
    ...(entitlement ? { dependencies: { entitlement } } : {}),
  });
}

function door({
  app = retentionApp(),
  permitted = () => true,
}: {
  app?: DataRetentionModule;
  permitted?: (permission: string) => boolean;
} = {}) {
  const asked: Asked[] = [];
  const handled: string[] = [];
  const members: TrpcRuntimeMembers<DoorContext> = {
    identity: { caller: (ctx) => ({ actor: { type: "user", id: ctx.actor.id } }) },
    authorization: {
      forRequest: () => ({
        getDecision: async ({ permission, scope }) => {
          asked.push({ permission, scope });

          return { permitted: permitted(permission), organizationRole: null };
        },
        getProjectAnyDecision: async () => ({ permitted: true, organizationRole: null }),
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
  const runtime = createTrpcRuntime({ root, procedure: root.procedure, members });
  const watched = new Proxy(app, {
    get: (target, name) => {
      if (typeof name === "string") handled.push(name);
      const member: unknown = Reflect.get(target, name, target);

      return typeof member === "function" ? member.bind(target) : member;
    },
  });
  const call = runtime
    .mount(dataRetentionTrpcTransport, () => watched)
    .createCaller({ actor: { id: "user-1" } });

  return { asked, handled, app, call };
}

function codeOf(failure: unknown): unknown {
  return (failure as { cause?: { code?: unknown } }).cause?.code;
}

const write = (scope: { scopeType: "ORGANIZATION" | "TEAM" | "PROJECT"; scopeId: string }) => ({
  projectId: WEB_APP,
  organizationId: ACME,
  scope,
  category: "traces" as const,
  retentionDays: 63,
});

describe("given a caller who may update web-app but may not manage acme", () => {
  const notAnAdmin = (permission: string) => permission !== "organization:manage";

  describe("when they set an organization-level retention through the door", () => {
    /** @scenario "A caller without the target's permission is refused before data retention runs" */
    it("is refused naming organization:manage, and data retention is never called", async () => {
      const { call, handled } = door({ permitted: notAnAdmin });

      const failure = await call
        .setForScope(write({ scopeType: "ORGANIZATION", scopeId: ACME }))
        .catch((error: unknown) => error);

      expect(codeOf(failure)).toBe("permission_denied");
      expect(handled).not.toContain("changeScopeRetention");
    });

    /** @scenario "A project admin cannot set an organization-wide override" */
    it("is refused as forbidden", async () => {
      const failure = await door({ permitted: notAnAdmin })
        .call.setForScope(write({ scopeType: "ORGANIZATION", scopeId: ACME }))
        .catch((error: unknown) => error);

      expect(codeOf(failure)).toBe("permission_denied");
    });
  });

  describe("when they set their own project's retention", () => {
    /** @scenario "A project member sets their own project's retention" */
    it("asks project:update on the project and writes the override anchored to acme", async () => {
      const { call, asked, app } = door({ permitted: notAnAdmin });

      await call.setForScope(write({ scopeType: "PROJECT", scopeId: WEB_APP }));

      expect(asked).toEqual([
        { permission: "project:update", scope: { tier: "project", id: WEB_APP } },
      ]);
      await expect(app.listOrganizationRules({ organizationId: ACME })).resolves.toEqual([
        expect.objectContaining({ scopeType: "PROJECT", scopeId: WEB_APP, organizationId: ACME }),
      ]);
    });
  });
});

describe("given a caller who may write a team but not the team's tier", () => {
  describe("when they save an override on the team", () => {
    /** @scenario "A retention rule a caller has no standing to write is refused by name" */
    it("is refused naming team:manage", async () => {
      const failure = await door({ permitted: (permission) => permission !== "team:manage" })
        .call.setForScope(write({ scopeType: "TEAM", scopeId: PLATFORM }))
        .catch((error: unknown) => error);

      expect(codeOf(failure)).toBe("permission_denied");
      expect((failure as { cause: { meta: unknown } }).cause.meta).toMatchObject({
        permission: "team:manage",
      });
    });
  });
});

describe("given an administrator of acme naming acme", () => {
  describe("when the target sits in globex", () => {
    /** @scenario "A team or project of another organisation is refused as not found" */
    it("refuses setting, previewing and removing it, and writes nothing", async () => {
      const { call, app } = door();
      const targets = [
        { scopeType: "TEAM", scopeId: GLOBEX.teamId },
        { scopeType: "PROJECT", scopeId: "project-billing" },
      ] as const;

      for (const scope of targets) {
        const refusals = await Promise.all([
          call.setForScope(write(scope)).catch((error: unknown) => error),
          call
            .previewScopeRemoval({ projectId: WEB_APP, organizationId: ACME, scope })
            .catch((error: unknown) => error),
          call
            .removeForScope({ projectId: WEB_APP, organizationId: ACME, scope, category: "traces" })
            .catch((error: unknown) => error),
        ]);

        expect(refusals.map(codeOf)).toEqual(
          Array(3).fill("data_retention_scope_target_not_found"),
        );
      }
      await expect(app.listOrganizationRules({ organizationId: ACME })).resolves.toEqual([]);
      await expect(
        app.listOrganizationRules({ organizationId: GLOBEX.organizationId }),
      ).resolves.toEqual([]);
    });
  });

  describe("when the organization scope is globex", () => {
    /** @scenario "An organisation scope must be the organisation the caller names" */
    it("is refused as not found", async () => {
      const failure = await door()
        .call.setForScope(write({ scopeType: "ORGANIZATION", scopeId: GLOBEX.organizationId }))
        .catch((error: unknown) => error);

      expect(codeOf(failure)).toBe("data_retention_scope_target_not_found");
    });
  });

  describe("when the team has no project folded under it", () => {
    /** @scenario "A team with no project folded yet is refused as not found" */
    it("is refused as not found", async () => {
      const failure = await door()
        .call.setForScope(write({ scopeType: "TEAM", scopeId: "team-research" }))
        .catch((error: unknown) => error);

      expect(codeOf(failure)).toBe("data_retention_scope_target_not_found");
    });
  });

  describe("when acme is on the free plan", () => {
    /** @scenario "The plan gate reads the organisation the caller names" */
    it("refuses the team write as a paid capability, reading no directory", async () => {
      const directory = MemoryRetentionDirectory.create();
      const app = createDataRetentionTestApp({
        repositories: {
          ...MemoryDataRetentionRepositories.create(),
          directory: new Proxy(directory, {
            get: () => {
              throw new Error("a scope write read the directory");
            },
          }),
          projectScopes: MemoryDataRetentionProjectScopeRepository.create({
            rows: [retentionTestScopeRow(WEB_APP)],
          }),
        },
        dependencies: {
          entitlement: createDataRetentionTestEntitlement({ free: true, type: "FREE" }),
        },
      });

      const failure = await door({ app })
        .call.setForScope(write({ scopeType: "TEAM", scopeId: PLATFORM }))
        .catch((error: unknown) => error);

      expect(codeOf(failure)).toBe("data_retention_not_on_plan");
    });
  });
});
