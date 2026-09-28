/**
 * @vitest-environment node
 * CLI token revocation, the governance project and `/api/me/usage`, through the installed app.
 */
import { createApiFixture } from "@langwatch/api-fixture";
import type { AuthApi } from "@langwatch/auth-contract";
import type { AuthzApi } from "@langwatch/authz-contract";
import type { EnterpriseGatewayApi } from "@langwatch/enterprise-gateway-contract";
import type {
  GovernanceRestApi,
  PersonalUsageRollup,
} from "@langwatch/enterprise-governance-contract";
import type { GatewayApi } from "@langwatch/gateway-contract";
import { createApp, withMemoryRepositories } from "@langwatch/kernel";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import {
  type InternalProject,
  PROJECT_KIND,
  type ProjectApi,
  type ProjectIdentity,
} from "@langwatch/project-contract";
import type { RedisConnection } from "@langwatch/redis-client";
import { prismaDouble } from "@langwatch/test-harness/client-doubles/prisma";
import { redisDouble } from "@langwatch/test-harness/client-doubles/redis";
import { UserApi } from "@langwatch/user-contract";
import { describe, expect, it, vi } from "vitest";

import { userServer } from "../../user.server.ts";
import {
  createUserTestAuth,
  createUserTestOps,
  createUserTestOrganizations,
} from "./user.fixture.ts";

const ORGANIZATION_ID = "org-1";

const personalProject: ProjectIdentity = {
  id: "project-personal-1",
  name: "Ada",
  slug: "ada",
  teamId: "team-personal-1",
  organizationId: ORGANIZATION_ID,
  isPersonal: true,
  ownerUserId: "user-1",
};

const governanceProject: InternalProject = {
  id: "project-governance-1",
  name: "Governance",
  slug: "governance",
  teamId: "team-governance-1",
  kind: PROJECT_KIND.INTERNAL_GOVERNANCE,
  archivedAtMs: null,
  traceSharingEnabled: false,
};

const rollup: PersonalUsageRollup = {
  summary: {
    spentUsd: 5,
    billedUsd: 5,
    requests: 3,
    promptTokens: 30,
    completionTokens: 15,
    mostUsedModel: { name: "claude-opus", usagePct: 67 },
  },
  dailyBuckets: [{ day: "2026-09-01", spentUsd: 5, billedUsd: 5, requests: 3 }],
  breakdownByModel: [{ label: "claude-opus", spentUsd: 5, billedUsd: 5, requests: 3 }],
};

function process(
  role: "api" | "worker",
  peers: Readonly<{ auth?: AuthApi; governance?: GovernanceRestApi; project?: ProjectApi }>,
) {
  return createApp({ role })
    .withModules([withMemoryRepositories(userServer)])
    .withMembers({ passkeysEnabled: false, publicBaseUrl: undefined })
    .withRelational(
      prismaDouble({
        organizationUser: { findFirst: async () => null },
        organization: { findUnique: async () => null },
        project: { findFirst: async () => null },
      }) satisfies PrismaClient,
    )
    .withKeyvalue(
      redisDouble({
        incr: async () => 1,
        expire: async () => 1,
        ttl: async () => -1,
      }) satisfies RedisConnection,
    )
    .provide({
      auth: peers.auth ?? createUserTestAuth(),
      authz: createApiFixture<AuthzApi>(),
      "enterprise-gateway": createApiFixture<EnterpriseGatewayApi>(),
      gateway: createApiFixture<GatewayApi>(),
      governance: peers.governance ?? createApiFixture<GovernanceRestApi>(),
      organization: createUserTestOrganizations(),
      ops: createUserTestOps(),
      project: peers.project ?? createApiFixture<ProjectApi>(),
    });
}

describe("user app over governance's seams", () => {
  describe("when a person deactivates their own account", () => {
    /** @scenario "userService.deactivate also revokes CLI tokens" */
    it.each(["api", "worker"] as const)(
      "revokes their CLI tokens through auth in the %s role",
      async (role) => {
        const auth = Object.assign(createUserTestAuth(), {
          revokeCliTokens: vi.fn(async () => ({ revokedCount: 2 })),
        });
        const runtime = await process(role, { auth }).boot();

        try {
          const app = runtime.service(UserApi);
          const created = await app.createCredentialUser({
            name: "Ada",
            email: "ada@example.com",
            passwordHash: "hashed:first",
          });

          await app.deactivateAccount({
            userId: created.id,
            caller: { id: created.id, operatorId: created.id, impersonated: false },
          });

          expect(auth.revokeCliTokens).toHaveBeenCalledWith({ userId: created.id });
        } finally {
          await runtime.stop();
        }
      },
    );
  });

  describe("when a personal key reads /api/me/usage", () => {
    /** @scenario "Ingestion-source spend is included and scoped to this organization" */
    it("rolls up against this organization's governance project", async () => {
      const findInternal = vi.fn(async () => governanceProject);
      const personalUsage = vi.fn(async () => rollup);
      const runtime = await process("api", {
        project: createApiFixture<ProjectApi>({
          findIdentity: async () => personalProject,
          findInternal,
        }),
        governance: createApiFixture<GovernanceRestApi>({ personalUsage }),
      }).boot();

      try {
        const usage = await runtime.service(UserApi).getPersonalUsage({
          projectId: personalProject.id,
          credential: { kind: "apiKey", userId: "user-1", organizationId: ORGANIZATION_ID },
        });

        expect(usage).toEqual(rollup);
        expect(findInternal).toHaveBeenCalledWith({
          organizationId: ORGANIZATION_ID,
          kind: PROJECT_KIND.INTERNAL_GOVERNANCE,
        });
        expect(personalUsage).toHaveBeenCalledWith({
          personalProjectId: personalProject.id,
          userId: "user-1",
          ingestionTenantId: governanceProject.id,
        });
      } finally {
        await runtime.stop();
      }
    });

    it("reads the personal project alone where no governance project was minted", async () => {
      const personalUsage = vi.fn(async () => rollup);
      const runtime = await process("api", {
        project: createApiFixture<ProjectApi>({
          findIdentity: async () => personalProject,
          findInternal: async () => null,
        }),
        governance: createApiFixture<GovernanceRestApi>({ personalUsage }),
      }).boot();

      try {
        await runtime.service(UserApi).getPersonalUsage({
          projectId: personalProject.id,
          credential: { kind: "legacyProjectKey" },
          window: { startMs: 1_000, endMs: 2_000 },
        });

        expect(personalUsage).toHaveBeenCalledWith({
          personalProjectId: personalProject.id,
          userId: "user-1",
          window: { startMs: 1_000, endMs: 2_000 },
        });
      } finally {
        await runtime.stop();
      }
    });
  });
});
