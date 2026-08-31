/**
 * The governance application's ingestion-template operations: resolving the
 * project's organization, and attributing a write to the caller who asked.
 *
 * Ported from
 * `platform/app/src/app/api/governance/__tests__/governance-audit-surface.integration.test.ts`,
 * whose @audit-uniform contract is that the SAME write reaching us over four
 * surfaces produces four identical records apart from the surface name. That
 * suite drove all four through the process; the rule it was proving lives here,
 * where each door meets one object, so it is proved here instead of four times.
 *
 * Spec: specs/ai-gateway/governance/governance-api-cli-mcp-coverage.feature
 *       (@bdd @governance-api @audit-uniform)
 */
import type { AuthzService } from "@langwatch/authz-contract";
import {
  type CreateIngestionTemplateInput,
  type GovernanceCallSurface,
  type IngestionTemplate,
} from "@langwatch/enterprise-governance-contract";
import type { OrganizationService } from "@langwatch/organization-contract";
import type { ProjectService } from "@langwatch/project-contract";
import { describe, expect, it, vi } from "vitest";
import {
  GovernanceApp,
  type GovernancePersonalVirtualKeyPorts,
  type GovernanceProjectCaller,
} from "../governance.app";
import { TestGovernanceService } from "./support/test-governance-service";

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
    governance,
    projects: {
      getOrganizationId,
      tryFindInternal: unreachable<ProjectService["tryFindInternal"]>(),
    },
    organizations: {
      ensurePersonalWorkspace: unreachable<OrganizationService["ensurePersonalWorkspace"]>(),
      tryFindPersonalWorkspace: unreachable<OrganizationService["tryFindPersonalWorkspace"]>(),
    },
    permissions: { getDecision: unreachable<AuthzService["getDecision"]>() },
    personalVirtualKeys: {
      isOrganizationMember:
        unreachable<GovernancePersonalVirtualKeyPorts["isOrganizationMember"]>(),
      hasActivePersonalKeyLabelled:
        unreachable<GovernancePersonalVirtualKeyPorts["hasActivePersonalKeyLabelled"]>(),
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
    /** @scenario "audit rows are identical apart from metadata.surface" */
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
