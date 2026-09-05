/**
 * The scoped privacy rules, served by the API process.
 */
import type { AuthzCanBatchByIdsInput, AuthzService } from "@langwatch/authz-contract";
import type { OrganizationService } from "@langwatch/organization-contract";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import type { ProjectService } from "@langwatch/project-contract";
import { describe, expect, it, vi } from "vitest";
import {
  ApiApplication,
  MissingAgentService,
  MissingSecretService,
} from "../../../api.application";
import { ApiTrpcFeaturesComposition } from "../../../app/api-trpc-features.composition";
import {
  stubCollaborators,
  stubComposedFeatures,
  stubInfrastructureEntitlements,
} from "../../../app/__tests__/api-trpc-record.test-doubles";
import { composeDataPrivacyFeature } from "../data-privacy.composition";

const SESSION_USER = { id: "user-1", name: "Sam Rivers", email: "sam@acme.test", role: "ADMIN" };
const PROJECT_ID = "project-1";
const ORGANIZATION_ID = "organization-1";
const TEAM_ID = "team-1";

/**
 * The rows the privacy cascade reads, as a double.
 */
function testPrisma() {
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
      findUnique: vi.fn(async () => ({ organizationId: ORGANIZATION_ID })),
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
function testAuthz(): AuthzService {
  return {
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
  } as unknown as AuthzService;
}

function composeApplication() {
  const authz = testAuthz();
  const infrastructure = {
    ...stubInfrastructureEntitlements(),
    prisma: testPrisma(),
    authz,
    audit: undefined,
  };
  const dataPrivacy = composeDataPrivacyFeature({
    infrastructure,
    peers: {
      projects: {
        getWithTeam: async () => ({
          id: PROJECT_ID,
          teamId: TEAM_ID,
          departmentId: null,
          isPersonal: false,
          team: { organizationId: ORGANIZATION_ID },
        }),
        getOrganizationId: async () => ORGANIZATION_ID,
      } as unknown as ProjectService,
      organizations: {
        getOrganizationMembers: async () => [],
        getTeamById: async () => ({ organizationId: ORGANIZATION_ID }),
      } as unknown as OrganizationService,
    },
  });

  const features = ApiTrpcFeaturesComposition.tryCompose({
    composed: { ...stubComposedFeatures(), dataPrivacy },
    infrastructure,
    collaborators: stubCollaborators(),
  });
  if (!features) throw new Error("the record refused to compose against its collaborators");

  const application = ApiApplication.create({
    agents: new MissingAgentService(),
    secrets: new MissingSecretService(),
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
): Promise<{ status: number; body: unknown }> {
  if (!application.hono) throw new Error("HTTP composition was not created.");
  const response = await application.hono.request(
    `http://127.0.0.1/api/trpc/${path}?input=${encodeURIComponent(JSON.stringify({ json: input }))}`,
  );
  return { status: response.status, body: await response.json() };
}

describe("given an API process composed with the privacy rules", () => {
  describe("when the privacy settings page is opened", () => {
    /** @scenario "The data privacy snapshot is filtered by what the caller may read" */
    it("answers from the read model in the data-privacy package", async () => {
      const { application } = composeApplication();

      const { status, body } = await callTrpc(application, "dataPrivacy.getSnapshot", {
        projectId: PROJECT_ID,
      });

      expect({ status, body }).toMatchObject({ status: 200 });
      const snapshot = (body as { result: { data: { json: Record<string, unknown> } } }).result.data
        .json;

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
});
