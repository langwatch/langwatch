import type { AgentApi } from "@langwatch/agent-contract";
import { createApiFixture } from "@langwatch/api-fixture";
import type { ApiKeyApi } from "@langwatch/api-key-contract";
import type { AuditLogApi } from "@langwatch/audit-log-contract";
import type { AuthApi } from "@langwatch/auth-contract";
import type { AuthzApi } from "@langwatch/authz-contract";
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
import { ResourceScope } from "@langwatch/kernel";
import type { ModelProviderApi } from "@langwatch/model-provider-contract";
import type { OrganizationApi } from "@langwatch/organization-contract";
import type { ProjectApi } from "@langwatch/project-contract";
import { ScopedSecrets } from "@langwatch/secrets";
import type { TraceApi } from "@langwatch/trace-contract";
import type { UserApi } from "@langwatch/user-contract";
import { describe, expect, it, vi } from "vitest";

import type { GovernanceEncryptor } from "../../app/governance.members.ts";
import { governanceServer } from "../../governance.server.ts";
import type { GovernanceRepositories } from "../../repositories/governance.repositories.ts";
import { MemoryGovernanceRepositories } from "../../repositories/memory/memory.governance.repositories.ts";
import {
  GovernanceApp,
  type GovernanceCliMembers,
  type GovernanceIngestMembers,
} from "../governance.app.ts";
import { TestGovernanceService } from "./support/test-governance-service.ts";

/** A dependency these operations never reach; calling one is the test's bug. */
const unreachable = <Method>(): Method =>
  (() => Promise.reject(new Error("not reachable from this operation"))) as Method;

const ORGANIZATION_ID = "org-1";
const PROJECT_ID = "project-1";

async function buildApp() {
  const getOrganizationId = vi.fn<ProjectApi["getOrganizationId"]>(async () => ORGANIZATION_ID);
  const repositories = MemoryGovernanceRepositories.create();

  const app = await GovernanceApp.create({
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
      modelProviders: createApiFixture<ModelProviderApi>(),
      users: createApiFixture<UserApi>(),
      auditLog: createApiFixture<AuditLogApi>(),
    },
    members: {
      encryption: createApiFixture<GovernanceEncryptor>(),
      isSaas: false,
    },
    resources: new ResourceScope(),
    secrets: new ScopedSecrets(async (_handle, build) => build(undefined)),
  });

  return { app, getOrganizationId, repositories };
}

/** The one app in this file that also carries the still-unfinished bag. */
async function buildAppWithUnfinishedCapability(planType = "ENTERPRISE") {
  const repositories: GovernanceRepositories = MemoryGovernanceRepositories.create();
  const governance = new TestGovernanceService();
  const findCliAccessSession = vi.fn<AuthApi["findCliAccessSession"]>(async () => ({
    userId: "user-1",
    organizationId: "organization-1",
    clientInfo: { deviceLabel: "Work laptop", hostname: "laptop" },
  }));
  const getActivePlan = vi.fn<EntitlementApi["getActivePlan"]>(
    async () =>
      ({
        type: planType,
      }) as never,
  );

  const app = await GovernanceApp.create({
    config: void 0,
    repositories,
    dependencies: {
      agents: createApiFixture<AgentApi>(),
      projects: createApiFixture<ProjectApi>(),
      auth: createApiFixture<AuthApi>({ findCliAccessSession }),
      entitlements: createApiFixture<EntitlementApi>({ getActivePlan }),
      organizations: createApiFixture<OrganizationApi>(),
      permissions: createApiFixture<AuthzApi>(),
      scim: createApiFixture<ScimApi>(),
      featureFlags: createApiFixture<FeatureFlagApi>(),
      traces: createApiFixture<TraceApi>(),
      apiKeys: createApiFixture<ApiKeyApi>(),
      gateway: createApiFixture<GatewayApi>(),
      modelProviders: createApiFixture<ModelProviderApi>(),
      users: createApiFixture<UserApi>(),
      auditLog: createApiFixture<AuditLogApi>(),
    },
    members: {
      encryption: createApiFixture<GovernanceEncryptor>(),
      isSaas: false,
      governance,
      cli: {
        members: unreachable<GovernanceCliMembers["members"]>(),
        persons: unreachable<GovernanceCliMembers["persons"]>(),
        supportContacts: unreachable<GovernanceCliMembers["supportContacts"]>(),
      },
      ingest: {
        projects: unreachable<GovernanceIngestMembers["projects"]>(),
        principals: unreachable<GovernanceIngestMembers["principals"]>(),
        traceCollection: unreachable<GovernanceIngestMembers["traceCollection"]>(),
      },
    },
    resources: new ResourceScope(),
    secrets: new ScopedSecrets(async (_handle, build) => build(undefined)),
  });

  return { app, findCliAccessSession, getActivePlan };
}

describe("GovernanceApp ingestion templates", () => {
  describe("given a caller who names only their project", () => {
    it("resolves the organization from the project rather than taking one", async () => {
      const { app, getOrganizationId, repositories } = await buildApp();
      const listUserVisible = vi.spyOn(repositories.ingestionTemplates, "listUserVisible");

      await app.listIngestionTemplatesForMember({ projectId: PROJECT_ID });

      expect(getOrganizationId).toHaveBeenCalledWith(PROJECT_ID);
      expect(listUserVisible).toHaveBeenCalledWith(ORGANIZATION_ID);
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

describe("GovernanceApp as the module a process installs", () => {
  describe("given the one REST declaration the module mounts", () => {
    it("answers every capability the declarations name from the one app", async () => {
      const { app } = await buildAppWithUnfinishedCapability();

      expect(governanceServer.transports.map((transport) => transport.protocol)).toEqual([
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
      expect(app.cliAccess().findCaller).toBeTypeOf("function");
      expect(app.cliCredentials().budgetStatus).toBeTypeOf("function");
      expect(app.cliActivity().sources).toBeTypeOf("function");
      expect(app.governance().cliBootstrapResolve).toBeTypeOf("function");
      expect(typeof app.ingestOtlpTraces).toBe("function");
      expect(typeof app.ingestWebhook).toBe("function");
      expect(typeof app.ingestOtlpLogs).toBe("function");
      expect(typeof app.ingestOtlpMetrics).toBe("function");
    });

    it("resolves the CLI caller and Enterprise plan through the named peers", async () => {
      const { app, findCliAccessSession, getActivePlan } = await buildAppWithUnfinishedCapability();

      await expect(app.cliAccess().findCaller("Bearer lw_at_token")).resolves.toEqual({
        user_id: "user-1",
        organization_id: "organization-1",
        client_info: { device_label: "Work laptop", hostname: "laptop" },
      });
      await expect(
        app.cliAccess().planDecision({
          organizationId: "organization-2",
          feature: "ingestionSources",
        }),
      ).resolves.toEqual({ entitled: true });

      expect(findCliAccessSession).toHaveBeenCalledWith({ authorization: "Bearer lw_at_token" });
      expect(getActivePlan).toHaveBeenCalledWith({ organizationId: "organization-2" });
    });

    it("refuses the caller organization when its plan is not Enterprise", async () => {
      const { app, getActivePlan } = await buildAppWithUnfinishedCapability("FREE");

      await expect(
        app.cliAccess().planDecision({
          organizationId: "organization-2",
          feature: "ingestionSources",
        }),
      ).resolves.toMatchObject({ entitled: false });

      expect(getActivePlan).toHaveBeenCalledWith({ organizationId: "organization-2" });
    });
  });

  describe("given a process that supplies none of the still-unfinished capability", () => {
    it("still constructs, and only the capability itself throws", async () => {
      const { app } = await buildApp();

      expect(() => app.governance()).toThrow(/governance/);
      await expect(app.listIngestionTemplatesForMember({ projectId: PROJECT_ID })).resolves.toEqual(
        [],
      );
    });
  });
});
