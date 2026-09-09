/**
 * `codingAgents.*`, installed the same way every converted module is
 * installed: `defineModule("coding-agent")` booted through
 * `createApp().withModule(codingAgentServer).boot({ role: "api" })`. Proves
 * the production composition genuinely boots through that one construction
 * path, rather than a hand-built `CodingAgentApp.create(...)` call.
 */
import type { AuthzService } from "@langwatch/authz-contract";
import type { PlanProvider } from "@langwatch/entitlement-contract";
import type { GithubService } from "@langwatch/github-contract";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import type { ProjectApi } from "@langwatch/project-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it } from "vitest";
import type { ApiTrpcInfrastructure } from "../../../platform/infrastructure/api-trpc.infrastructure.ts";
import { composeCodingAgentFeature } from "../coding-agent.composition.ts";

const PROJECT_ID = "project-1";

/**
 * None of the scope-resolution ports below are exercised by this suite: every
 * scenario reads a method that answers before `#scope` is touched. Each is a
 * refusing fixture on purpose, so a test that starts needing one fails loudly
 * rather than reading a silently-empty double.
 */
function testInfrastructure(): ApiTrpcInfrastructure {
  return {
    prisma: createApiFixture<PrismaClient>(),
    authz: createApiFixture<AuthzService>(),
    plans: createApiFixture<Pick<PlanProvider, "getActivePlan">>(),
    featureFlags: createApiFixture(),
    saasBilling: false,
    audit: undefined,
    auditLog: createApiFixture(),
  };
}

async function composeApplication(projects: ProjectApi = createApiFixture<ProjectApi>()) {
  const github = createApiFixture<GithubService>({
    getWebBase: () => "https://github.test",
  });

  const feature = await composeCodingAgentFeature({
    infrastructure: testInfrastructure(),
    defaultRetentionDays: 90,
    peers: {
      projects,
      github,
      // No ClickHouse: a coding-agent session is a projection there, so the
      // module's own null repositories answer emptily rather than reaching a
      // real store.
      clickHouse: null,
    },
  });

  return { feature };
}

describe("given the API process installs coding-agent through defineModule", () => {
  describe("when the feature is composed", () => {
    it("boots the module through createApp().withModule().boot() and hands back its application", async () => {
      const { feature } = await composeApplication();

      expect(feature.app).toBeDefined();
      expect(feature.app.githubWebBase()).toBe("https://github.test");
    });

    it("hands the SAME application to both the packaged REST family and the tRPC namespace", async () => {
      const { feature } = await composeApplication();

      expect(feature.service).toBe(feature.app);
    });
  });

  describe("when the coding-agent page asks for a project's usage totals", () => {
    it("answers emptily on a process with no session storage", async () => {
      const { feature } = await composeApplication();

      const totals = await feature.app.getUsageTotals({
        projectId: PROJECT_ID,
        fromMs: 0,
        toMs: Date.now(),
      });

      expect(totals.sessionCount).toBe(0);
    });
  });

  describe("when a caller resolves the organization behind a project", () => {
    it("reads it from the projects peer instead of a wrongly named scope method", async () => {
      const projects = createApiFixture<ProjectApi>({
        getOrganizationId: async () => "organization-1",
      });
      const { feature } = await composeApplication(projects);

      await expect(feature.app.findOrganizationForProject(PROJECT_ID)).resolves.toBe(
        "organization-1",
      );
    });

    it("answers undefined for an orphan project rather than throwing", async () => {
      const projects = createApiFixture<ProjectApi>({
        getOrganizationId: async () => {
          throw new Error("no organization for this project");
        },
      });
      const { feature } = await composeApplication(projects);

      await expect(feature.app.findOrganizationForProject(PROJECT_ID)).resolves.toBeUndefined();
    });
  });
});
