/**
 * @vitest-environment node
 * `GatewayApp.authorizeKeyCaller`: any API key, including an organization key
 * that names no project, is authorized for organization-owned budget rows.
 * @see specs/ai-gateway/per-team-budget-reorganization.feature
 */
import { createApiFixture } from "@langwatch/api-fixture";
import type { AuthzApi } from "@langwatch/authz-contract";
import { ResourceScope } from "@langwatch/kernel";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import type { Encryption } from "@langwatch/process-stores";
import type { ProjectApi } from "@langwatch/project-contract";
import { ScopedSecrets } from "@langwatch/secrets";
import { clickHouseQueryClientDouble } from "@langwatch/test-harness/client-doubles/clickhouse";
import { prismaDouble } from "@langwatch/test-harness/client-doubles/prisma";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { GatewayApp } from "../gateway.app.ts";

function peer(name: string): never {
  return new Proxy(
    {},
    {
      get(_target, property) {
        if (typeof property === "symbol") return undefined;
        throw new Error(`The ${name} peer was called for "${String(property)}".`);
      },
    },
  ) as never;
}

const ORGANIZATION_ID = "org_1";
const PROJECT_ID = "project_1";
const TEAM_ID = "team_1";

const hasApiKeyPermission = vi.fn<AuthzApi["hasApiKeyPermission"]>();
const findOrganizationId = vi.fn<ProjectApi["findOrganizationId"]>();
const findProject = vi.fn();

const noSecrets = new ScopedSecrets(async (_handle, build) => build(undefined));

async function gatewayApp(): Promise<GatewayApp> {
  return GatewayApp.create({
    dependencies: {
      webhooks: peer("webhooks"),
      entitlement: peer("entitlement"),
      authz: createApiFixture<AuthzApi>({ hasApiKeyPermission }),
      projects: createApiFixture<ProjectApi>({ findOrganizationId }),
      evaluators: peer("evaluators"),
      monitors: peer("monitors"),
      organizations: peer("organizations"),
      featureFlags: peer("featureFlags"),
      modelProviders: peer("modelProviders"),
      traces: peer("traces"),
      oneTimeReveals: peer("oneTimeReveals"),
    },
    members: {
      prisma: prismaDouble({ project: { findUnique: findProject } }) as PrismaClient,
      clickhouse: clickHouseQueryClientDouble({
        query: async () => ({ rows: [] }),
        insert: async () => {},
      }),
      gatewayInternalProtocol: {},
      encryption: createApiFixture<Encryption>(),
    },
    config: {
      spendSettlementGraceMs: void 0,
      internalUrl: void 0,
      controlPlaneUrl: void 0,
      baseUrl: undefined,
      publicUrl: undefined,
      isSaas: false,
    },
    resources: new ResourceScope(),
    secrets: noSecrets,
  });
}

const organizationKey = {
  kind: "apiKey" as const,
  apiKeyId: "key_org",
  userId: "user_1",
  organizationId: ORGANIZATION_ID,
};

const projectKey = {
  ...organizationKey,
  apiKeyId: "key_project",
  resolvedProject: { id: PROJECT_ID, teamId: TEAM_ID },
};

describe("GatewayApp.authorizeKeyCaller", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hasApiKeyPermission.mockResolvedValue(true);
    findOrganizationId.mockResolvedValue(ORGANIZATION_ID);
    findProject.mockResolvedValue({ id: PROJECT_ID, teamId: TEAM_ID });
  });

  describe("given an organization key that names no project", () => {
    /** @scenario An organization key with no project lists the organization's budgets */
    it("checks the read at the organization and answers with the key's organization", async () => {
      const app = await gatewayApp();

      const authorized = await app.authorizeKeyCaller({
        caller: organizationKey,
        permission: "gatewayBudgets:view",
        reach: "caller",
      });

      expect(authorized.organizationId).toBe(ORGANIZATION_ID);
      expect(authorized.actorUserId).toBe("user_1");
      expect(hasApiKeyPermission).toHaveBeenCalledWith(
        expect.objectContaining({
          apiKeyId: "key_org",
          permission: "gatewayBudgets:view",
          scope: { type: "org", id: ORGANIZATION_ID },
        }),
      );
      expect(findOrganizationId).not.toHaveBeenCalled();
    });

    describe("when the key does not hold the permission", () => {
      /** @scenario A key without the budget permission is refused by permission, not as a bad key */
      it("refuses with permission_denied naming the permission", async () => {
        hasApiKeyPermission.mockResolvedValue(false);
        const app = await gatewayApp();

        const refusal = await app
          .authorizeKeyCaller({
            caller: organizationKey,
            permission: "gatewayBudgets:view",
            reach: "caller",
          })
          .catch((error: unknown) => error);

        expect(refusal).toMatchObject({
          code: "permission_denied",
          httpStatus: 403,
          meta: expect.objectContaining({ permission: "gatewayBudgets:view" }),
        });
      });
    });

    describe("when the service key acts as nobody", () => {
      it("records writes under a stable machine principal named after the key", async () => {
        const app = await gatewayApp();

        const authorized = await app.authorizeKeyCaller({
          caller: { ...organizationKey, userId: null },
          permission: "gatewayBudgets:create",
          reach: "organization",
        });

        expect(authorized.actorUserId).toBe("svc_key_org");
      });
    });
  });

  describe("given a key that resolved one project", () => {
    /** @scenario A project key keeps reading budgets at its own project */
    it("checks a read at that project", async () => {
      const app = await gatewayApp();

      await app.authorizeKeyCaller({
        caller: projectKey,
        permission: "gatewayBudgets:view",
        reach: "caller",
      });

      expect(hasApiKeyPermission).toHaveBeenCalledWith(
        expect.objectContaining({
          scope: { type: "project", id: PROJECT_ID, teamId: TEAM_ID },
        }),
      );
    });

    /** @scenario A budget write is checked at the organization whatever key calls it */
    it("checks a write at the organization", async () => {
      const app = await gatewayApp();

      await app.authorizeKeyCaller({
        caller: projectKey,
        permission: "gatewayBudgets:update",
        reach: "organization",
      });

      expect(hasApiKeyPermission).toHaveBeenCalledWith(
        expect.objectContaining({
          permission: "gatewayBudgets:update",
          scope: { type: "org", id: ORGANIZATION_ID },
        }),
      );
    });
  });

  describe("given a legacy project key", () => {
    it("reads at its own project with no permission lookup", async () => {
      const app = await gatewayApp();

      const authorized = await app.authorizeKeyCaller({
        caller: { kind: "project", projectId: PROJECT_ID },
        permission: "gatewayBudgets:view",
        reach: "caller",
      });

      expect(authorized).toMatchObject({
        organizationId: ORGANIZATION_ID,
        actorUserId: `svc_${PROJECT_ID}`,
      });
      expect(hasApiKeyPermission).not.toHaveBeenCalled();
    });

    /** @scenario A budget write is checked at the organization whatever key calls it */
    it("is refused an organization-wide write", async () => {
      const app = await gatewayApp();

      const refusal = await app
        .authorizeKeyCaller({
          caller: { kind: "project", projectId: PROJECT_ID },
          permission: "gatewayBudgets:create",
          reach: "organization",
        })
        .catch((error: unknown) => error);

      expect(refusal).toMatchObject({ code: "permission_denied" });
    });
  });
});
