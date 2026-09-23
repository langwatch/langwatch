import { createApiFixture } from "@langwatch/api-fixture";
/**
 * Resolving actor token to the person's workspace (for the bird's-eye /governance/users/[id] page).
 * Test verifies failed lookups return null (no info leak) and short-circuit.
 * Spec: specs/ai-gateway/governance/admin-trace-access.feature
 */
import type { AuthApi } from "@langwatch/auth-contract";
import type { AuthzApi } from "@langwatch/authz-contract";
import type { EntitlementApi } from "@langwatch/entitlement-contract";
import { ResourceScope } from "@langwatch/kernel";
import type { OrganizationApi, PersonalWorkspace } from "@langwatch/organization-contract";
import type { ProjectApi } from "@langwatch/project-contract";
import { describe, expect, it, vi } from "vitest";

import type { GovernanceMemberDatabase } from "../../governance.server.ts";
import { MemoryGovernanceRepositories } from "../../repositories/memory/memory.governance.repositories.ts";
import { GovernanceApp, type GovernanceActorUser } from "../governance.app.ts";

/** A dependency this operation never reaches; calling one is the test's bug. */
const unreachable = <Method>(): Method =>
  (() => Promise.reject(new Error("not reachable from this operation"))) as Method;

const ORGANIZATION_ID = "org-1";

const workspace: PersonalWorkspace = {
  team: {
    id: "team-personal-1",
    name: "Ariana",
    slug: "ariana",
    createdAtMs: 1_700_000_000_000,
  },
  project: {
    id: "project-personal-1",
    name: "Ariana",
    slug: "ariana-personal",
    apiKey: "apk-ariana",
    createdAtMs: 1_700_000_000_000,
  },
};

function buildApp(options: {
  user?: GovernanceActorUser | null;
  isMember?: boolean;
  workspace?: PersonalWorkspace | null;
}) {
  const tryFindUser = vi.fn(async () => options.user ?? null);
  const isOrganizationMember = vi.fn(async () =>
    options.isMember ? { userId: "member-1" } : null,
  );
  const tryFindPersonalWorkspace = vi.fn(async () => options.workspace ?? null);

  // The two Prisma reads `createGovernanceMemberInfrastructure` wraps: `findFirst`
  // is the only method either port calls, so the rest of each delegate is unreachable.
  const prisma = {
    user: { findFirst: tryFindUser },
    organizationUser: { findFirst: isOrganizationMember },
    virtualKey: { findFirst: unreachable<GovernanceMemberDatabase["virtualKey"]["findFirst"]>() },
  } as unknown as GovernanceMemberDatabase;

  const app = GovernanceApp.create({
    config: void 0,
    repositories: MemoryGovernanceRepositories.create(),
    dependencies: {
      projects: createApiFixture<ProjectApi>(),
      auth: createApiFixture<AuthApi>(),
      entitlements: createApiFixture<EntitlementApi>(),
      organizations: createApiFixture<OrganizationApi>({ tryFindPersonalWorkspace }),
      permissions: createApiFixture<AuthzApi>(),
    },
    members: { prisma },
    resources: new ResourceScope(),
  });

  return { app, tryFindUser, isOrganizationMember, tryFindPersonalWorkspace };
}

describe("GovernanceApp.tryResolveActorWorkspace", () => {
  describe("given an actor token that names a member with a personal workspace", () => {
    it("answers where that workspace lives", async () => {
      const { app, tryFindUser } = buildApp({
        user: { id: "user-1", name: "Ariana", email: "ariana@acme.com" },
        isMember: true,
        workspace,
      });

      await expect(
        app.findActorWorkspace({
          organizationId: ORGANIZATION_ID,
          actor: "ariana@acme.com",
        }),
      ).resolves.toEqual({
        userId: "user-1",
        displayName: "Ariana",
        teamId: "team-personal-1",
        projectId: "project-personal-1",
        projectSlug: "ariana-personal",
      });
      expect(tryFindUser).toHaveBeenCalledWith({
        where: { OR: [{ id: "ariana@acme.com" }, { email: "ariana@acme.com" }] },
        select: { id: true, name: true, email: true },
      });
    });

    it("falls back to the email, then the id, for a person with no name", async () => {
      const { app } = buildApp({
        user: { id: "user-1", name: null, email: "ariana@acme.com" },
        isMember: true,
        workspace,
      });
      await expect(
        app.findActorWorkspace({ organizationId: ORGANIZATION_ID, actor: "user-1" }),
      ).resolves.toMatchObject({ displayName: "ariana@acme.com" });

      const nameless = buildApp({
        user: { id: "user-1", name: null, email: null },
        isMember: true,
        workspace,
      });
      await expect(
        nameless.app.findActorWorkspace({
          organizationId: ORGANIZATION_ID,
          actor: "user-1",
        }),
      ).resolves.toMatchObject({ displayName: "user-1" });
    });
  });

  describe("given a token that names nobody", () => {
    it("answers null without asking about membership", async () => {
      const { app, isOrganizationMember, tryFindPersonalWorkspace } = buildApp({
        user: null,
      });

      await expect(
        app.findActorWorkspace({
          organizationId: ORGANIZATION_ID,
          actor: "stranger@example.com",
        }),
      ).resolves.toBeNull();
      expect(isOrganizationMember).not.toHaveBeenCalled();
      expect(tryFindPersonalWorkspace).not.toHaveBeenCalled();
    });
  });

  describe("given a person who is not in this organization", () => {
    it("answers null without reading their workspace", async () => {
      const { app, tryFindPersonalWorkspace } = buildApp({
        user: { id: "user-2", name: "Ben", email: "ben@other.com" },
        isMember: false,
        workspace,
      });

      await expect(
        app.findActorWorkspace({
          organizationId: ORGANIZATION_ID,
          actor: "ben@other.com",
        }),
      ).resolves.toBeNull();
      expect(tryFindPersonalWorkspace).not.toHaveBeenCalled();
    });
  });

  describe("given a member who has no personal workspace yet", () => {
    it("answers null rather than a half-resolved link", async () => {
      const { app } = buildApp({
        user: { id: "user-3", name: "Cara", email: "cara@acme.com" },
        isMember: true,
        workspace: null,
      });

      await expect(
        app.findActorWorkspace({
          organizationId: ORGANIZATION_ID,
          actor: "cara@acme.com",
        }),
      ).resolves.toBeNull();
    });
  });
});
