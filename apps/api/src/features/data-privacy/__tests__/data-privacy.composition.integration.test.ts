/**
 * The scoped privacy rules, served by the API process.
 */
import type { AgentApi } from "@langwatch/agent-contract";
import type { AuthzApi, AuthzCanBatchByIdsInput } from "@langwatch/authz-contract";
import type { OrganizationApi } from "@langwatch/organization-contract";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import type { ProjectApi } from "@langwatch/project-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it, vi } from "vitest";
import { ApiApplication } from "../../../api.application.ts";
import { ApiTrpcFeaturesComposition } from "../../../app/api-trpc-features.composition.ts";
import {
  stubCollaborators,
  stubComposedFeatures,
  stubInfrastructureEntitlements,
} from "../../../app/__tests__/api-trpc-record.test-doubles.ts";
import { installApiDataPrivacy } from "../data-privacy.composition.ts";

const SESSION_USER = { id: "user-1", name: "Sam Rivers", email: "sam@acme.test", role: "ADMIN" };
const PROJECT_ID = "project-1";
const ORGANIZATION_ID = "organization-1";
const TEAM_ID = "team-1";

/**
 * The rows the privacy cascade reads, as a double.
 */
function testPrisma(options: { teamOrganizationId?: string | null } = {}) {
  const teamOrganizationId =
    options.teamOrganizationId === undefined ? ORGANIZATION_ID : options.teamOrganizationId;

  return {
    project: {
      findUnique: vi.fn(async () => ({
        id: PROJECT_ID,
        name: "Acme production",
        teamId: TEAM_ID,
        team: { organizationId: ORGANIZATION_ID, organization: { name: "Acme" } },
      })),
      findMany: vi.fn(async () => [
        { id: PROJECT_ID, name: "Acme production", teamId: TEAM_ID },
        { id: "project-2", name: "Acme staging", teamId: TEAM_ID },
      ]),
    },
    team: {
      findMany: vi.fn(async () => [{ id: TEAM_ID, name: "Platform" }]),
      findUnique: vi.fn(async () =>
        teamOrganizationId === null ? null : { organizationId: teamOrganizationId },
      ),
    },
    department: { findMany: vi.fn(async () => []), findUnique: vi.fn(async () => null) },
    group: { findMany: vi.fn(async () => [{ id: "group-1", name: "Auditors" }]) },
    organization: { findUnique: vi.fn(async () => ({ id: ORGANIZATION_ID })) },
    dataPrivacyPolicy: {
      findMany: vi.fn(async () => [
        {
          id: "policy-org",
          organizationId: ORGANIZATION_ID,
          scopeType: "ORGANIZATION",
          scopeId: ORGANIZATION_ID,
          personalOnly: false,
          config: { categories: { input: { disposition: "drop" } } },
          createdAt: new Date("2026-01-01T00:00:00.000Z"),
          updatedAt: new Date("2026-01-01T00:00:00.000Z"),
        },
        {
          id: "policy-project",
          organizationId: ORGANIZATION_ID,
          scopeType: "PROJECT",
          scopeId: PROJECT_ID,
          personalOnly: false,
          config: { categories: { output: { disposition: "drop" } } },
          createdAt: new Date("2026-01-01T00:00:00.000Z"),
          updatedAt: new Date("2026-01-01T00:00:00.000Z"),
        },
      ]),
    },
  } as unknown as PrismaClient;
}

/**
 * Permits the organization but NOT the second project, so the RBAC filter over
 * the snapshot is observable rather than assumed: a filter that permitted
 * everything would pass whether it ran or not.
 */
function testAuthz(): AuthzApi {
  return createApiFixture<AuthzApi>({
    hasPermission: async () => true,
    canBatchByIds: async (input: AuthzCanBatchByIdsInput) => ({
      teams: new Map(input.teams.map((team) => [team.teamId, true])),
      projects: new Map(
        input.projects.map((project) => [project.projectId, project.projectId === PROJECT_ID]),
      ),
      organizationRole: null,
    }),
    getDecision: async () => ({ permitted: true, organizationRole: null }),
    getProjectAnyDecision: async () => ({ permitted: true, organizationRole: null }),
    checkScopeLineage: async () => ({ kind: "consistent" }),
  });
}

async function composeApplication(prismaOptions: { teamOrganizationId?: string | null } = {}) {
  const authz = testAuthz();
  const infrastructure = {
    ...stubInfrastructureEntitlements(),
    prisma: testPrisma(prismaOptions),
    authz,
    audit: undefined,
  };
  const dataPrivacy = await installApiDataPrivacy({
    infrastructure,
    peers: {
      projects: createApiFixture<ProjectApi>({
        getWithTeam: async () => ({
          id: PROJECT_ID,
          teamId: TEAM_ID,
          departmentId: null,
          isPersonal: false,
          team: { organizationId: ORGANIZATION_ID },
        }),
      }),
      organizations: createApiFixture<OrganizationApi>({
        getTeamById: async () => ({ organizationId: ORGANIZATION_ID }),
      }),
      permissions: authz,
    },
  });

  const features = ApiTrpcFeaturesComposition.tryCompose({
    composed: { ...stubComposedFeatures(), dataPrivacy },
    infrastructure,
    collaborators: stubCollaborators({ dataPrivacy: dataPrivacy.app }),
  });
  if (!features) throw new Error("the record refused to compose against its collaborators");

  const application = ApiApplication.create({
    agents: createApiFixture<AgentApi>(),
    features,
    http: {
      createContext: async () => ({
        actor: () => ({ id: SESSION_USER.id }),
        tryActor: () => ({ id: SESSION_USER.id }),
        authorize: async () => undefined,
        session: { user: SESSION_USER },
      }),
    },
  });

  return { application };
}

async function callTrpc(
  application: ApiApplication,
  path: string,
  input: Record<string, unknown>,
  method: "query" | "mutation" = "query",
): Promise<{ status: number; body: unknown }> {
  if (!application.hono) throw new Error("HTTP composition was not created.");
  const url = `http://127.0.0.1/api/trpc/${path}`;
  const response =
    method === "mutation"
      ? await application.hono.request(url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(input),
        })
      : await application.hono.request(`${url}?input=${encodeURIComponent(JSON.stringify(input))}`);

  return { status: response.status, body: await response.json() };
}

/** The tRPC code a refusal answered with, as the browser reads it. */
function refusalCode(body: unknown): string | undefined {
  return (body as { error?: { data?: { code?: string } } }).error?.data?.code;
}

describe("given an API process composed with the privacy rules", () => {
  describe("when the privacy settings page is opened", () => {
    /** @scenario "The data privacy snapshot is filtered by what the caller may read" */
    it("answers from the read model in the data-privacy package", async () => {
      const { application } = await composeApplication();

      const { status, body } = await callTrpc(application, "dataPrivacy.getSnapshot", {
        projectId: PROJECT_ID,
      });

      expect({ status, body }).toMatchObject({ status: 200 });
      const snapshot = (body as { result: { data: Record<string, unknown> } }).result.data;

      expect(snapshot.projectId).toBe(PROJECT_ID);
      // Both baselines are resolved, which is the whole cascade running: the
      // TEAM one stops at this project's team, the ORGANIZATION one keeps only
      // organization rules.
      expect(snapshot.effectiveTeam).not.toBeNull();
      expect(snapshot.effectiveOrganization).not.toBeNull();

      // Both stored rules are readable here, and each is NAMED from the
      // directory rather than echoed back as its id.
      const rules = snapshot.rules as Array<{ scopeType: string; name: string }>;
      expect(rules.map((rule) => rule.scopeType).sort()).toEqual(["ORGANIZATION", "PROJECT"]);
      expect(rules.find((rule) => rule.scopeType === "ORGANIZATION")?.name).toBe("Acme");
      expect(rules.find((rule) => rule.scopeType === "PROJECT")?.name).toBe("Acme production");

      // The RBAC filter is observable rather than assumed: the second project
      // is in the organization's directory and the caller cannot write it, so
      // the chip picker is never offered it.
      const available = snapshot.available as { projects: Array<{ id: string }> };
      expect(available.projects.map((project) => project.id)).toEqual([PROJECT_ID]);
      expect((snapshot.audienceOptions as { groups: unknown[] }).groups).toEqual([
        { id: "group-1", name: "Auditors" },
      ]);
    });
  });

  describe("when a rule is written at a scope that no longer exists", () => {
    /** @scenario "A rule aimed at a scope that no longer exists is refused by name" */
    it("answers NOT_FOUND rather than a generic server failure", async () => {
      const { application } = await composeApplication({ teamOrganizationId: null });

      const { status, body } = await callTrpc(
        application,
        "dataPrivacy.setForScope",
        {
          projectId: PROJECT_ID,
          scope: { scopeType: "TEAM", scopeId: "gone" },
          personalOnly: false,
          config: { categories: { input: { disposition: "drop" } } },
        },
        "mutation",
      );

      expect({ status, code: refusalCode(body) }).toEqual({ status: 404, code: "NOT_FOUND" });
    });
  });

  describe("when a rule carries a pattern the feature refuses", () => {
    /** @scenario "A rule whose pattern is refused says which pattern and why" */
    it("answers BAD_REQUEST rather than a generic server failure", async () => {
      const { application } = await composeApplication();

      const { status, body } = await callTrpc(
        application,
        "dataPrivacy.setForScope",
        {
          projectId: PROJECT_ID,
          scope: { scopeType: "TEAM", scopeId: TEAM_ID },
          personalOnly: false,
          config: { secrets: { enabled: true, customPatterns: [".*"] } },
        },
        "mutation",
      );

      expect({ status, code: refusalCode(body) }).toEqual({ status: 400, code: "BAD_REQUEST" });
    });
  });
});
