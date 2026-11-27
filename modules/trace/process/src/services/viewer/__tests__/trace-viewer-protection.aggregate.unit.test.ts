import {
  type Authorization,
  narrowAuthorization,
  sealAuthorization,
} from "@langwatch/authorization";
import { builtinRoleGrants, type AuthzApi } from "@langwatch/authz-contract";
import {
  EMPTY_AUDIENCE,
  PLATFORM_DEFAULT_DATA_PRIVACY,
  type DataPrivacyApi,
} from "@langwatch/data-privacy-contract";
import type { PlanProvider } from "@langwatch/entitlement-contract";
import type { ProjectApi } from "@langwatch/project-contract";
import { createTestLogger } from "@langwatch/test-harness";
/**
 * The privacy policy a read is shown under is the strictest across the projects its proof
 * names (ADR-177 decision 9); a proof minted for another project says nothing about it.
 */
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it } from "vitest";

import { TraceViewerProtectionService } from "../../trace-viewer-protection.service.ts";

const AGG = "proj_aggregate";
const A = "proj_member_a";
const B = "proj_member_b";

const proof = ({ shared }: { shared: string[] }): Authorization =>
  sealAuthorization({
    actor: { type: "user", id: "user-1" },
    principal: { type: "user", id: "user-1" },
    scope: { organizationId: "organization-1" },
    grants: [
      { projectId: AGG, permissions: ["traces:view"], via: [], kind: "own" },
      ...shared.map((projectId, index) => ({
        projectId,
        permissions: ["traces:view" as const],
        via: [`grant_${index}`],
        kind: "shared" as const,
        condition: { type: "trace" as const, from: 0, until: null },
      })),
    ],
    expiresAt: Date.now() + 60_000,
    purpose: { kind: "route", route: "test" },
  });

async function policyProjectsFor({
  projectId,
  authorization,
}: {
  projectId: string;
  authorization?: Authorization;
}): Promise<readonly string[][]> {
  const asked: string[][] = [];
  await TraceViewerProtectionService.create({
    authz: createApiFixture<AuthzApi>({ hasPermission: async () => true }),
    projects: createApiFixture<ProjectApi>({ findWithTeam: async () => null }),
    plans: createApiFixture<PlanProvider>({}),
    dataPrivacy: createApiFixture<DataPrivacyApi>({
      getResolvedForProjects: async ({ projectIds }) => {
        asked.push([...projectIds]);

        return PLATFORM_DEFAULT_DATA_PRIVACY;
      },
    }),
    fallbackVisibilityDays: 30,
    logger: createTestLogger().logger,
  }).resolve({ projectId, userId: "user-1", publiclyShared: false, authorization });

  return asked;
}

describe("resolving a viewer's protections", () => {
  describe("when the read carries no proof", () => {
    it("folds the shown project's policy alone", async () => {
      expect(await policyProjectsFor({ projectId: AGG })).toEqual([[AGG]]);
    });
  });

  describe("when the proof reads an aggregate's members", () => {
    it("folds the aggregate's policy and every member's", async () => {
      expect(
        await policyProjectsFor({ projectId: AGG, authorization: proof({ shared: [A, B] }) }),
      ).toEqual([[AGG, A, B]]);
    });
  });

  describe("when the proof is narrowed to the member that holds the trace", () => {
    it("folds the aggregate's policy and that member's only", async () => {
      const narrowed = narrowAuthorization({
        authorization: proof({ shared: [A, B] }),
        projectId: A,
      });

      expect(await policyProjectsFor({ projectId: AGG, authorization: narrowed })).toEqual([
        [AGG, A],
      ]);
    });
  });

  describe("when a member is read directly through its own proof", () => {
    it("folds that member's policy alone, so the aggregate's strictness stays with the aggregate", async () => {
      const own = sealAuthorization({
        actor: { type: "user", id: "user-1" },
        principal: { type: "user", id: "user-1" },
        scope: { organizationId: "organization-1" },
        grants: [{ projectId: A, permissions: ["traces:view"], via: [], kind: "own" }],
        expiresAt: Date.now() + 60_000,
        purpose: { kind: "route", route: "test" },
      });

      expect(await policyProjectsFor({ projectId: A, authorization: own })).toEqual([[A]]);
    });
  });

  describe("when the proof was minted for another project", () => {
    it("ignores the proof and folds the shown project's policy alone", async () => {
      expect(
        await policyProjectsFor({ projectId: A, authorization: proof({ shared: [B] }) }),
      ).toEqual([[A]]);
    });
  });
});

describe("given input restricted to admins, read through an aggregate", () => {
  const adminsOnlyInput = {
    ...PLATFORM_DEFAULT_DATA_PRIVACY,
    categories: {
      ...PLATFORM_DEFAULT_DATA_PRIVACY.categories,
      input: { disposition: "restrict" as const, audience: { ...EMPTY_AUDIENCE, admins: true } },
    },
  };

  /** The viewer's built-in role at each project; none where the map names none. */
  function inputVisibleWith(roleAt: Record<string, "admin" | "member">) {
    return TraceViewerProtectionService.create({
      authz: createApiFixture<AuthzApi>({
        hasPermission: async ({ permission, projectId }) => {
          const role = projectId === undefined ? undefined : roleAt[projectId];
          return role !== undefined && builtinRoleGrants({ role, permission });
        },
      }),
      projects: createApiFixture<ProjectApi>({ findWithTeam: async () => null }),
      plans: createApiFixture<PlanProvider>({}),
      dataPrivacy: createApiFixture<DataPrivacyApi>({
        getResolvedForProjects: async () => adminsOnlyInput,
      }),
      fallbackVisibilityDays: 30,
      logger: createTestLogger().logger,
    })
      .resolve({
        projectId: AGG,
        userId: "user-1",
        publiclyShared: false,
        authorization: proof({ shared: [B] }),
      })
      .then((protections) => protections.canSeeCapturedInput);
  }

  /** @scenario "Admins-only content stays hidden when a read spans a project where the viewer is no admin" */
  it("hides it from the aggregate's Admin who is only a Member of the member project", async () => {
    await expect(inputVisibleWith({ [AGG]: "admin", [B]: "member" })).resolves.toBe(false);
  });

  it("shows it to an Admin of every project the read spans", async () => {
    await expect(inputVisibleWith({ [AGG]: "admin", [B]: "admin" })).resolves.toBe(true);
  });
});
