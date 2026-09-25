import type { AgentApi } from "@langwatch/agent-contract";
import { createApiFixture } from "@langwatch/api-fixture";
import type { ApiKeyApi } from "@langwatch/api-key-contract";
import type { AuditLogApi } from "@langwatch/audit-log-contract";
import type { AuthApi } from "@langwatch/auth-contract";
import type { AuthzApi } from "@langwatch/authz-contract";
import type { EnterpriseGatewayApi } from "@langwatch/enterprise-gateway-contract";
/**
 * Resolving actor token to the person's workspace (for the bird's-eye /governance/users/[id] page).
 * Test verifies failed lookups return null (no info leak) and short-circuit.
 * Spec: specs/ai-gateway/governance/admin-trace-access.feature
 */
import type { ScimApi } from "@langwatch/enterprise-scim-contract";
import type { EntitlementApi } from "@langwatch/entitlement-contract";
import type { FeatureFlagApi } from "@langwatch/feature-flag-contract";
import type { GatewayApi } from "@langwatch/gateway-contract";
import { ResourceScope } from "@langwatch/kernel";
import type { ModelProviderApi } from "@langwatch/model-provider-contract";
import {
  type OrganizationApi,
  type PersonalWorkspace,
  TeamNotFoundError,
} from "@langwatch/organization-contract";
import type { ProjectApi } from "@langwatch/project-contract";
import { ScopedSecrets } from "@langwatch/secrets";
import type { TraceApi } from "@langwatch/trace-contract";
import type { UserApi, UserProfile } from "@langwatch/user-contract";
import { describe, expect, it, vi } from "vitest";

import type { GovernanceEncryptor } from "../../app/governance.members.ts";
import { MemoryGovernanceRepositories } from "../../repositories/memory/memory.governance.repositories.ts";
import { GovernanceApp } from "../governance.app.ts";

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

type ActorUser = Pick<UserProfile, "id" | "name" | "email">;

function profileOf(user: ActorUser): UserProfile {
  const at = new Date(1_700_000_000_000);
  return {
    ...user,
    emailVerified: true,
    image: null,
    pendingSsoSetup: false,
    createdAt: at,
    updatedAt: at,
    lastLoginAt: null,
    deactivatedAt: null,
  };
}

async function buildApp(options: {
  user?: ActorUser | null;
  isMember?: boolean;
  workspace?: PersonalWorkspace | null;
}) {
  const user = options.user ? profileOf(options.user) : null;
  const findById = vi.fn(async ({ id }: { id: string }) => (user?.id === id ? user : null));
  const findByEmail = vi.fn(async ({ email }: { email: string }) =>
    user?.email === email ? user : null,
  );
  const isOrganizationMember = vi.fn(async () => options.isMember === true);
  const getPersonalWorkspace = vi.fn(async () => {
    if (!options.workspace) throw new TeamNotFoundError();
    return options.workspace;
  });

  const app = await GovernanceApp.create({
    config: void 0,
    repositories: MemoryGovernanceRepositories.create(),
    dependencies: {
      agents: createApiFixture<AgentApi>(),
      projects: createApiFixture<ProjectApi>(),
      auth: createApiFixture<AuthApi>(),
      entitlements: createApiFixture<EntitlementApi>(),
      organizations: createApiFixture<OrganizationApi>({
        getPersonalWorkspace,
        isMember: isOrganizationMember,
      }),
      permissions: createApiFixture<AuthzApi>(),
      scim: createApiFixture<ScimApi>(),
      featureFlags: createApiFixture<FeatureFlagApi>(),
      traces: createApiFixture<TraceApi>(),
      apiKeys: createApiFixture<ApiKeyApi>(),
      gateway: createApiFixture<GatewayApi>(),
      enterpriseGateway: createApiFixture<EnterpriseGatewayApi>(),
      modelProviders: createApiFixture<ModelProviderApi>(),
      users: createApiFixture<UserApi>({ findById, findByEmail }),
      auditLog: createApiFixture<AuditLogApi>(),
    },
    members: { encryption: createApiFixture<GovernanceEncryptor>(), isSaas: false },
    resources: new ResourceScope(),
    secrets: new ScopedSecrets(async (_handle, build) => build(undefined)),
  });

  return { app, findByEmail, isOrganizationMember, getPersonalWorkspace };
}

describe("GovernanceApp.tryResolveActorWorkspace", () => {
  describe("given an actor token that names a member with a personal workspace", () => {
    it("answers where that workspace lives", async () => {
      const { app, findByEmail } = await buildApp({
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
      expect(findByEmail).toHaveBeenCalledWith({ email: "ariana@acme.com" });
    });

    it("falls back to the email, then the id, for a person with no name", async () => {
      const { app } = await buildApp({
        user: { id: "user-1", name: null, email: "ariana@acme.com" },
        isMember: true,
        workspace,
      });
      await expect(
        app.findActorWorkspace({ organizationId: ORGANIZATION_ID, actor: "user-1" }),
      ).resolves.toMatchObject({ displayName: "ariana@acme.com" });

      const nameless = await buildApp({
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
      const { app, isOrganizationMember, getPersonalWorkspace } = await buildApp({
        user: null,
      });

      await expect(
        app.findActorWorkspace({
          organizationId: ORGANIZATION_ID,
          actor: "stranger@example.com",
        }),
      ).resolves.toBeNull();
      expect(isOrganizationMember).not.toHaveBeenCalled();
      expect(getPersonalWorkspace).not.toHaveBeenCalled();
    });
  });

  describe("given a person who is not in this organization", () => {
    it("answers null without reading their workspace", async () => {
      const { app, getPersonalWorkspace } = await buildApp({
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
      expect(getPersonalWorkspace).not.toHaveBeenCalled();
    });
  });

  describe("given a member who has no personal workspace yet", () => {
    it("answers null rather than a half-resolved link", async () => {
      const { app } = await buildApp({
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
