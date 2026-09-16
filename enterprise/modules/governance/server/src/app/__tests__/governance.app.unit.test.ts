/**
 * Ingestion-template operations: resolve organization and attribute writes.
 * Moved from @audit-uniform integration test (proves the rule once at unit level instead of
 * four times). Spec: specs/ai-gateway/governance/governance-api-cli-mcp-coverage.feature.
 */
import type { AuthzApi } from "@langwatch/authz-contract";
import {
  type CreateIngestionTemplateInput,
  type GovernanceCallSurface,
  type IngestionTemplate,
} from "@langwatch/enterprise-governance-contract";
import type { OrganizationApi } from "@langwatch/organization-contract";
import type { ProjectApi } from "@langwatch/project-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it, vi } from "vitest";
import { MemoryGovernanceRepositories } from "../../repositories/memory/memory.governance.repositories.ts";
import {
  GovernanceApp,
  type GovernanceActorDirectory,
  type GovernancePersonalVirtualKeyMembers,
  type GovernanceProjectCaller,
  type GovernanceCliMembers,
  type GovernanceIngestMembers,
} from "../governance.app.ts";
import { governanceServer } from "../../governance.server.ts";
import { TestGovernanceService } from "./support/test-governance-service.ts";

/** A dependency these operations never reach; calling one is the test's bug. */
const unreachable = <Method>(): Method =>
  (() => Promise.reject(new Error("not reachable from this operation"))) as Method;

const ORGANIZATION_ID = "org-1";
const PROJECT_ID = "project-1";

const row: IngestionTemplate = {
  id: "tmpl-1",
  slug: "internal_codex_abc123",
  sourceType: "internal_codex",
  displayName: "Internal Codex",
  description: null,
  iconAsset: null,
  credentialSchema: null,
  ottlRules: "",
  platformPublished: false,
  enabled: true,
  organizationId: ORGANIZATION_ID,
};

function buildApp(overrides: Partial<TestGovernanceService> = {}) {
  const governance = Object.assign(new TestGovernanceService(), overrides);
  const getOrganizationId = vi.fn(async () => ORGANIZATION_ID);

  const app = GovernanceApp.create({
    repositories: MemoryGovernanceRepositories.create(),
    dependencies: {
      projects: createApiFixture<ProjectApi>({ getOrganizationId }),
      organizations: createApiFixture<OrganizationApi>(),
      permissions: createApiFixture<AuthzApi>(),
    },
    members: {
      governance,
      personalVirtualKeys: {
        isOrganizationMember:
          unreachable<GovernancePersonalVirtualKeyMembers["isOrganizationMember"]>(),
        hasActivePersonalKeyLabelled:
          unreachable<GovernancePersonalVirtualKeyMembers["hasActivePersonalKeyLabelled"]>(),
      },
      actors: { findUser: unreachable<GovernanceActorDirectory["findUser"]>() },
      cli: {
        accessTokens: unreachable<GovernanceCliMembers["accessTokens"]>(),
        members: unreachable<GovernanceCliMembers["members"]>(),
        plans: unreachable<GovernanceCliMembers["plans"]>(),
        persons: unreachable<GovernanceCliMembers["persons"]>(),
        supportContacts: unreachable<GovernanceCliMembers["supportContacts"]>(),
      },
      ingest: {
        projects: unreachable<GovernanceIngestMembers["projects"]>(),
        principals: unreachable<GovernanceIngestMembers["principals"]>(),
        traceCollection: unreachable<GovernanceIngestMembers["traceCollection"]>(),
      },
    },
  });

  return { app, getOrganizationId };
}

describe("GovernanceApp ingestion templates", () => {
  describe("given a caller who names only their project", () => {
    it("resolves the organization from the project rather than taking one", async () => {
      const templateListForUser = vi.fn(async () => [row]);
      const { app, getOrganizationId } = buildApp({ templateListForUser });

      await app.listIngestionTemplatesForMember({ projectId: PROJECT_ID });

      expect(getOrganizationId).toHaveBeenCalledWith(PROJECT_ID);
      expect(templateListForUser).toHaveBeenCalledWith({ organizationId: ORGANIZATION_ID });
    });

    it("resolves it the same way for every template operation", async () => {
      const calls: string[] = [];
      const record = <Input extends { organizationId: string }>(name: string) =>
        vi.fn(async (input: Input) => {
          calls.push(`${name}:${input.organizationId}`);
          return row;
        });
      const { app } = buildApp({
        templateListForOrgAdmin: vi.fn(async (input: { organizationId: string }) => {
          calls.push(`listForAdmin:${input.organizationId}`);
          return [row];
        }),
        templateGetByIdForOrg: record("get"),
        templateCreateOrg: record("create"),
        templateUpdateOttlRules: record("updateOttl"),
        templateCloneFromPlatform: record("clone"),
      });
      const by: GovernanceProjectCaller = {
        projectId: PROJECT_ID,
        userId: "user-1",
        surface: "hono",
      };

      await app.listIngestionTemplatesForAdmin({ projectId: PROJECT_ID });
      await app.getIngestionTemplate({ projectId: PROJECT_ID, id: "tmpl-1" });
      await app.createIngestionTemplate(
        { sourceType: "internal_codex", displayName: "Internal Codex" },
        by,
      );
      await app.updateIngestionTemplateOttlRules({ id: "tmpl-1", ottlRules: "" }, by);
      await app.cloneIngestionTemplate({ sourceTemplateId: "tmpl-platform" }, by);

      expect(calls).toEqual([
        `listForAdmin:${ORGANIZATION_ID}`,
        `get:${ORGANIZATION_ID}`,
        `create:${ORGANIZATION_ID}`,
        `updateOttl:${ORGANIZATION_ID}`,
        `clone:${ORGANIZATION_ID}`,
      ]);
    });
  });

  describe("given a caller behind a legacy project key, which is bound to no person", () => {
    /**
     * There is no user to name, and the audit row still has to say who acted.
     * `svc_<projectId>` is the one answer, decided here so that every door
     * records the same string rather than each inventing its own.
     */
    it("attributes the write to the project itself", async () => {
      const templateCreateOrg = vi.fn(async () => row);
      const { app } = buildApp({ templateCreateOrg });

      await app.createIngestionTemplate(
        { sourceType: "internal_codex", displayName: "Internal Codex" },
        { projectId: PROJECT_ID, userId: null, surface: "hono" },
      );

      expect(templateCreateOrg).toHaveBeenCalledWith(
        expect.objectContaining({ callerUserId: `svc_${PROJECT_ID}` }),
      );
    });

    it("attributes it to the member when the credential names one", async () => {
      const templateCreateOrg = vi.fn(async () => row);
      const { app } = buildApp({ templateCreateOrg });

      await app.createIngestionTemplate(
        { sourceType: "internal_codex", displayName: "Internal Codex" },
        { projectId: PROJECT_ID, userId: "user-1", surface: "hono" },
      );

      expect(templateCreateOrg).toHaveBeenCalledWith(
        expect.objectContaining({ callerUserId: "user-1" }),
      );
    });
  });

  describe("when the same creation arrives over each of the four surfaces", () => {
    /** @scenario "State-changing calls emit audit rows regardless of surface" */
    it("records four writes that differ only in the surface", async () => {
      const written: CreateIngestionTemplateInput[] = [];
      const templateCreateOrg = vi.fn(async (input: CreateIngestionTemplateInput) => {
        written.push(input);
        return row;
      });
      const { app } = buildApp({ templateCreateOrg });
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

      const everythingButTheSurface = {
        organizationId: ORGANIZATION_ID,
        callerUserId: "user-1",
        sourceType: "internal_codex",
        displayName: "Internal Codex",
        description: "Custom",
        iconAsset: null,
        credentialSchema: null,
        ottlRules: 'set(attributes["langwatch.cost.usd"], attributes["x"])',
      };

      expect(written.map((input) => input.surface)).toEqual(surfaces);
      expect(written.map(({ surface: _surface, ...rest }) => rest)).toEqual([
        everythingButTheSurface,
        everythingButTheSurface,
        everythingButTheSurface,
        everythingButTheSurface,
      ]);
    });
  });
});

describe("GovernanceApp as the module a process installs", () => {
  describe("given the three REST declarations the module mounts", () => {
    /** @scenario "Every governance REST family answers from the installed module" */
    it("answers every capability the declarations name from the one app", () => {
      const { app } = buildApp();

      expect(governanceServer.transports).toHaveLength(3);
      expect(app.cliAccess().findCaller).toBeTypeOf("function");
      expect(app.cliCredentials().budgetStatus).toBeTypeOf("function");
      expect(app.cliActivity().sources).toBeTypeOf("function");
      expect(app.governance().cliBootstrapResolve).toBeTypeOf("function");
      expect(app.ingestAccess().authorize).toBeTypeOf("function");
      expect(app.ingestReceiver().receiveTraces).toBeTypeOf("function");
    });
  });
});
