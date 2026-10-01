import type { AgentApi } from "@langwatch/agent-contract";
import type { ApiKeyApi } from "@langwatch/api-key-contract";
import type { AuditLogApi } from "@langwatch/audit-log-contract";
import type { AuthApi } from "@langwatch/auth-contract";
import type { AuthzApi } from "@langwatch/authz-contract";
import type { EnterpriseGatewayApi } from "@langwatch/enterprise-gateway-contract";
import type {
  GovernanceCallSurface,
  GovernanceProjectCaller,
} from "@langwatch/enterprise-governance-contract";
/**
 * Ingestion-template operations resolve the organization and attribute writes through
 * `IngestionTemplateService`, so `buildApp()` supplies no `governance`/`cli`/`ingest` member.
 * @see specs/ai-gateway/governance/governance-api-cli-mcp-coverage.feature
 */
import type { ScimApi } from "@langwatch/enterprise-scim-contract";
import type { EntitlementApi } from "@langwatch/entitlement-contract";
import type { FeatureFlagApi } from "@langwatch/feature-flag-contract";
import type { GatewayApi } from "@langwatch/gateway-contract";
import type { LogApi } from "@langwatch/log-contract";
import type { MetricApi } from "@langwatch/metric-contract";
import type { ModelProviderApi } from "@langwatch/model-provider-contract";
import type { OrganizationApi } from "@langwatch/organization-contract";
import { ResourceScope } from "@langwatch/process";
import type { ProjectApi } from "@langwatch/project-contract";
import { ScopedSecrets } from "@langwatch/secrets";
import { memoryRateLimiter } from "@langwatch/test-harness";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import type { TraceApi } from "@langwatch/trace-contract";
import type { UserApi } from "@langwatch/user-contract";
import { describe, expect, it, vi } from "vitest";

import type { GovernanceEncryptor } from "../../app/governance.members.ts";
import { governanceProcessModule } from "../../governance.module.ts";
import type { GovernanceRepositories } from "../../repositories/governance.repositories.ts";
import { MemoryGovernanceRepositories } from "../../repositories/memory/memory.governance.repositories.ts";
import { GovernanceModule } from "../governance.app.ts";

const ORGANIZATION_ID = "org-1";
const PROJECT_ID = "project-1";

async function buildApp() {
  const getOrganizationId = vi.fn<ProjectApi["getOrganizationId"]>(async () => ORGANIZATION_ID);
  const repositories = MemoryGovernanceRepositories.create();

  const app = await GovernanceModule.create({
    config: void 0,
    repositories,
    dependencies: {
      agents: createApiFixture<AgentApi>(),
      projects: createApiFixture<ProjectApi>({ getOrganizationId }),
      auth: createApiFixture<AuthApi>(),
      entitlements: createApiFixture<EntitlementApi>(),
      organizations: createApiFixture<OrganizationApi>(),
      permissions: createApiFixture<AuthzApi>(),
      scim: createApiFixture<ScimApi>(),
      featureFlags: createApiFixture<FeatureFlagApi>(),
      traces: createApiFixture<TraceApi>(),
      apiKeys: createApiFixture<ApiKeyApi>(),
      gateway: createApiFixture<GatewayApi>(),
      enterpriseGateway: createApiFixture<EnterpriseGatewayApi>(),
      modelProviders: createApiFixture<ModelProviderApi>(),
      users: createApiFixture<UserApi>(),
      auditLog: createApiFixture<AuditLogApi>(),
      logs: createApiFixture<LogApi>(),
      metrics: createApiFixture<MetricApi>(),
    },
    members: {
      encryption: createApiFixture<GovernanceEncryptor>(),
      isSaas: false,
      rateLimiter: memoryRateLimiter(),
    },
    resources: new ResourceScope(),
    secrets: new ScopedSecrets(async (_handle, build) => build(undefined)),
  });

  return { app, getOrganizationId, repositories };
}

/** The app with a CLI session and a plan decision the CLI plane reads. */
async function buildCliApp(planType = "ENTERPRISE") {
  const repositories: GovernanceRepositories = MemoryGovernanceRepositories.create();
  const getCliAccessSession = vi.fn<AuthApi["getCliAccessSession"]>(async () => ({
    userId: "user-1",
    organizationId: "organization-1",
    tokenKey: "lwcli:access:lw_at_token",
    clientInfo: { deviceLabel: "Work laptop", hostname: "laptop" },
  }));
  const getActivePlan = vi.fn<EntitlementApi["getActivePlan"]>(
    async () =>
      ({
        type: planType,
      }) as never,
  );

  const app = await GovernanceModule.create({
    config: void 0,
    repositories,
    dependencies: {
      agents: createApiFixture<AgentApi>(),
      projects: createApiFixture<ProjectApi>(),
      auth: createApiFixture<AuthApi>({ getCliAccessSession }),
      entitlements: createApiFixture<EntitlementApi>({ getActivePlan }),
      organizations: createApiFixture<OrganizationApi>(),
      permissions: createApiFixture<AuthzApi>(),
      scim: createApiFixture<ScimApi>(),
      featureFlags: createApiFixture<FeatureFlagApi>(),
      traces: createApiFixture<TraceApi>(),
      apiKeys: createApiFixture<ApiKeyApi>(),
      gateway: createApiFixture<GatewayApi>(),
      enterpriseGateway: createApiFixture<EnterpriseGatewayApi>(),
      modelProviders: createApiFixture<ModelProviderApi>(),
      users: createApiFixture<UserApi>(),
      auditLog: createApiFixture<AuditLogApi>(),
      logs: createApiFixture<LogApi>(),
      metrics: createApiFixture<MetricApi>(),
    },
    members: {
      encryption: createApiFixture<GovernanceEncryptor>(),
      isSaas: false,
      rateLimiter: memoryRateLimiter(),
    },
    resources: new ResourceScope(),
    secrets: new ScopedSecrets(async (_handle, build) => build(undefined)),
  });

  return { app, getCliAccessSession, getActivePlan };
}

describe("GovernanceModule ingestion templates", () => {
  describe("given a caller who names only their project", () => {
    it("resolves the organization from the project rather than taking one", async () => {
      const { app, getOrganizationId, repositories } = await buildApp();
      const findUserVisible = vi.spyOn(repositories.ingestionTemplates, "findUserVisible");

      await app.listIngestionTemplatesForMember({ projectId: PROJECT_ID });

      expect(getOrganizationId).toHaveBeenCalledWith(PROJECT_ID);
      expect(findUserVisible).toHaveBeenCalledWith(ORGANIZATION_ID);
    });

    it("resolves it the same way for every template operation", async () => {
      const { app, getOrganizationId, repositories } = await buildApp();
      const by: GovernanceProjectCaller = {
        projectId: PROJECT_ID,
        userId: "user-1",
        surface: "hono",
      };
      // Seeded directly on the repository, bypassing `by.projectId`, so this
      // does not itself count toward the organization-resolution assertion.
      const platformTemplate = await repositories.ingestionTemplates.createWithAudit({
        template: {
          slug: "platform_seed",
          sourceType: "internal_codex",
          displayName: "Platform Seed",
          description: null,
          iconAsset: null,
          credentialSchema: null,
          ottlRules: "",
          organizationId: null,
        },
        callerUserId: "seed",
        surface: "hono",
      });

      const created = await app.createIngestionTemplate(
        { sourceType: "internal_codex", displayName: "Internal Codex" },
        by,
      );
      await app.listIngestionTemplatesForAdmin({ projectId: PROJECT_ID });
      await app.getIngestionTemplate({ projectId: PROJECT_ID, id: created.id });
      await app.updateIngestionTemplateOttlRules({ id: created.id, ottlRules: "" }, by);
      await app.cloneIngestionTemplate({ sourceTemplateId: platformTemplate.id }, by);

      expect(getOrganizationId).toHaveBeenCalledTimes(5);
      expect(getOrganizationId.mock.calls.every(([projectId]) => projectId === PROJECT_ID)).toBe(
        true,
      );
    });
  });

  describe("given a caller behind a legacy project key, which is bound to no person", () => {
    /**
     * There is no user to name, and the audit row still has to say who acted.
     * `svc_<projectId>` is the one answer, decided here so that every door
     * records the same string rather than each inventing its own.
     */
    it("attributes the write to the project itself", async () => {
      const { app, repositories } = await buildApp();
      const createWithAudit = vi.spyOn(repositories.ingestionTemplates, "createWithAudit");

      await app.createIngestionTemplate(
        { sourceType: "internal_codex", displayName: "Internal Codex" },
        { projectId: PROJECT_ID, userId: null, surface: "hono" },
      );

      expect(createWithAudit).toHaveBeenCalledWith(
        expect.objectContaining({ callerUserId: `svc_${PROJECT_ID}` }),
      );
    });

    it("attributes it to the member when the credential names one", async () => {
      const { app, repositories } = await buildApp();
      const createWithAudit = vi.spyOn(repositories.ingestionTemplates, "createWithAudit");

      await app.createIngestionTemplate(
        { sourceType: "internal_codex", displayName: "Internal Codex" },
        { projectId: PROJECT_ID, userId: "user-1", surface: "hono" },
      );

      expect(createWithAudit).toHaveBeenCalledWith(
        expect.objectContaining({ callerUserId: "user-1" }),
      );
    });
  });

  describe("when the same creation arrives over each of the four surfaces", () => {
    /** @scenario "State-changing calls emit audit rows regardless of surface" */
    it("records four writes that differ only in the surface", async () => {
      const { app, repositories } = await buildApp();
      const createWithAudit = vi.spyOn(repositories.ingestionTemplates, "createWithAudit");
      const surfaces: GovernanceCallSurface[] = ["trpc", "hono", "cli", "mcp"];

      for (const surface of surfaces) {
        await app.createIngestionTemplate(
          {
            sourceType: "internal_codex",
            displayName: "Internal Codex",
            description: "Custom",
            ottlRules: 'set(attributes["langwatch.cost.usd"], attributes["x"])',
          },
          { projectId: PROJECT_ID, userId: "user-1", surface },
        );
      }

      const everythingButSurfaceAndSlug = {
        organizationId: ORGANIZATION_ID,
        sourceType: "internal_codex",
        displayName: "Internal Codex",
        description: "Custom",
        iconAsset: null,
        credentialSchema: null,
        ottlRules: 'set(attributes["langwatch.cost.usd"], attributes["x"])',
      };

      expect(createWithAudit.mock.calls.map(([input]) => input.surface)).toEqual(surfaces);
      expect(createWithAudit.mock.calls.map(([input]) => input.callerUserId)).toEqual([
        "user-1",
        "user-1",
        "user-1",
        "user-1",
      ]);
      expect(
        createWithAudit.mock.calls.map(([input]) => {
          const { slug: _slug, ...rest } = input.template;
          return rest;
        }),
      ).toEqual([
        everythingButSurfaceAndSlug,
        everythingButSurfaceAndSlug,
        everythingButSurfaceAndSlug,
        everythingButSurfaceAndSlug,
      ]);
    });
  });
});

describe("GovernanceModule default AI tool catalogue", () => {
  describe("given an organization whose catalogue never had an entry", () => {
    /** @scenario "A fresh organization gets the full standard catalog with no admin action" */
    it("seeds every starter tile once, and nothing on a second ask", async () => {
      const { app } = await buildApp();
      const tiles = app.aiToolStarterPackCatalog();

      await expect(
        app.aiToolEnsureDefaultCatalog({ organizationId: ORGANIZATION_ID }),
      ).resolves.toEqual({ hasSeeded: true, created: tiles.length });
      await expect(
        app.aiToolEnsureDefaultCatalog({ organizationId: ORGANIZATION_ID }),
      ).resolves.toEqual({ hasSeeded: false, created: 0 });

      const entries = await app.aiToolListForAdmin({ organizationId: ORGANIZATION_ID });
      expect(entries.map(({ slug }) => slug).toSorted()).toEqual(
        tiles.map(({ slug }) => slug).toSorted(),
      );
    });
  });
});

describe("GovernanceModule as the module a process installs", () => {
  describe("given the one REST declaration the module mounts", () => {
    it("answers every capability the declarations name from the one app", async () => {
      const { app } = await buildCliApp();

      expect(governanceProcessModule.transports.map((transport) => transport.protocol)).toEqual([
        "rest",
        "rest",
        "rest",
        "trpc",
        "trpc",
        "trpc",
        "trpc",
        "trpc",
        "trpc",
        "trpc",
        "trpc",
        "trpc",
        "trpc",
        "trpc",
        "trpc",
        "trpc",
      ]);
      expect("admit" in app.cliAccess()).toBe(true);
      expect(app.cliCredentials().budgetStatus).toBeTypeOf("function");
      expect(app.cliActivity().sources).toBeTypeOf("function");
      expect(typeof app.ingestOtlpTraces).toBe("function");
      expect(typeof app.ingestWebhook).toBe("function");
      expect(typeof app.ingestOtlpLogs).toBe("function");
      expect(typeof app.ingestOtlpMetrics).toBe("function");
    });

    it("resolves the CLI caller and Enterprise plan through the named peers", async () => {
      const { app, getCliAccessSession, getActivePlan } = await buildCliApp();
      const request = new Request("http://api.test/api/auth/cli/bootstrap", {
        headers: { authorization: "Bearer lw_at_token" },
      });

      await expect(app.cliTokenDoor.identify({ request })).resolves.toEqual({
        actor: {
          type: "user",
          id: "user-1",
          cliSession: {
            tokenKey: "lwcli:access:lw_at_token",
            clientInfo: { deviceLabel: "Work laptop", hostname: "laptop" },
          },
        },
        scope: { tier: "organization", id: "organization-1" },
      });
      await expect(
        app.cliAccess().planDecision({
          organizationId: "organization-2",
          feature: "ingestionSources",
        }),
      ).resolves.toEqual({ entitled: true });

      expect(getCliAccessSession).toHaveBeenCalledWith({ authorization: "Bearer lw_at_token" });
      expect(getActivePlan).toHaveBeenCalledWith({ organizationId: "organization-2" });
    });

    it("refuses the caller organization when its plan is not Enterprise", async () => {
      const { app, getActivePlan } = await buildCliApp("FREE");

      await expect(
        app.cliAccess().planDecision({
          organizationId: "organization-2",
          feature: "ingestionSources",
        }),
      ).resolves.toMatchObject({ entitled: false });

      expect(getActivePlan).toHaveBeenCalledWith({ organizationId: "organization-2" });
    });
  });

  describe("given a process that composes the app over its peers alone", () => {
    it("constructs and answers a template read", async () => {
      const { app } = await buildApp();

      await expect(app.listIngestionTemplatesForMember({ projectId: PROJECT_ID })).resolves.toEqual(
        [],
      );
    });
  });
});
