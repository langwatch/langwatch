/**
 * The five tenant-administration features, served by the API process.
 */
import type {
  AuthzBindingForSynthesis,
  AuthzGetDecisionInput,
  AuthzScopeLineageResult,
  AuthzService,
  PermissionDecision,
} from "@langwatch/authz-contract";
import type { AgentApi } from "@langwatch/agent-contract";
import type { IdentityApi } from "@langwatch/identity-contract";
import type { ApiKeyApi } from "@langwatch/api-key-contract";
import type { GithubApi } from "@langwatch/github-contract";
import type { MonitorService } from "@langwatch/monitor-contract";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import type { ProjectApi } from "@langwatch/project-contract";
import type { ShareApi } from "@langwatch/share-contract";
import type { TopicApi } from "@langwatch/topic-contract";
import { EventEmitter } from "node:events";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it, vi } from "vitest";
import { ApiApplication } from "../../../api.application.ts";
import { ApiTrpcFeaturesComposition } from "../../../app/api-trpc-features.composition.ts";
import { composeAutomationFeature } from "../../automation/automation.composition.ts";
import { composeCodingAgentFeature } from "../../coding-agent/coding-agent.composition.ts";
import { composeEnterpriseFeature } from "../../enterprise/enterprise.composition.ts";
import { installApiProject } from "../../project/project.composition.ts";
import { installApiOrganization } from "../organization.composition.ts";
import {
  stubCollaborators,
  stubComposedFeatures,
  stubInfrastructureEntitlements,
  stubMount,
} from "../../../app/__tests__/api-trpc-record.test-doubles.ts";

const SESSION_USER = { id: "user-1", name: "Sam Rivers", email: "sam@acme.test", role: "ADMIN" };

/** The nine namespaces a tenant is administered through, as the wire names them. */
const TENANT_NAMESPACES = [
  "automation",
  "codingAgents",
  "emailSuppression",
  "license",
  "licenseEnforcement",
  "organization",
  "project",
  "scimToken",
  "ssoConnections",
] as const;
const PROJECT_ID = "project-1";
const ORGANIZATION_ID = "organization-1";

/**
 * One project row as the database holds it. The project module parses what it
 * reads, so a thinner row is refused as a validation failure rather than
 * answering the setup screen.
 */
const PROJECT_ROW = {
  id: PROJECT_ID,
  name: "Acme",
  slug: "acme",
  apiKey: "test-base-key",
  lwqlKey: "test-lwql-key",
  teamId: "team-1",
  language: "python",
  framework: "openai",
  kind: "DEFAULT",
  firstMessage: true,
  integrated: true,
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  updatedAt: new Date("2026-01-01T00:00:00.000Z"),
  userLinkTemplate: null,
  traceSharingEnabled: false,
  presenceEnabled: false,
  s3Endpoint: null,
  s3AccessKeyId: null,
  s3SecretAccessKey: null,
  s3Bucket: null,
  archivedAt: null,
  isPersonal: false,
  ownerUserId: null,
  personalFeatures: null,
  departmentId: null,
  langyEgressAllowlist: null,
  lastCodingAgentSessionAt: null,
  lastCodingAgentPullRequestAt: null,
};

/** The rows this half actually reads, as a double. */
function testPrisma() {
  const client = {
    project: {
      findUnique: vi.fn(async () => PROJECT_ROW),
      findFirst: vi.fn(async () => PROJECT_ROW),
      findMany: vi.fn(async () => []),
    },
    trigger: { findMany: vi.fn(async () => []) },
    triggerSent: { findMany: vi.fn(async () => []) },
    emailSuppression: { findMany: vi.fn(async () => []) },
    organizationInvite: {
      findUnique: vi.fn(async () => null),
      findMany: vi.fn(async () => [
        {
          id: "invite-1",
          organizationId: ORGANIZATION_ID,
          email: "newcomer@acme.test",
          inviteCode: "code-1",
          role: "MEMBER",
          status: "PENDING",
          teamIds: "",
          expiration: new Date("2099-01-01T00:00:00.000Z"),
          createdAt: new Date("2026-01-01T00:00:00.000Z"),
          requestedByUser: null,
        },
      ]),
    },
    organizationUser: { findUnique: vi.fn(async () => null) },
    team: { findUnique: vi.fn(async () => ({ organizationId: ORGANIZATION_ID })) },
    teamUser: { findMany: vi.fn(async () => []) },
    user: { findFirst: vi.fn(async () => null) },
  } as unknown as PrismaClient;

  const held = client as unknown as {
    trigger: { findMany: ReturnType<typeof vi.fn> };
    project: { findUnique: ReturnType<typeof vi.fn> };
  };
  return { client, trigger: held.trigger, project: held.project };
}

/** Permits everything: the refusal path is the declared check's own suite. */
function testAuthz(): AuthzService {
  return {
    hasPermission: vi.fn(async () => true),
    getDecision: async (_input: AuthzGetDecisionInput): Promise<PermissionDecision> => ({
      permitted: true,
      organizationRole: null,
    }),
    getProjectAnyDecision: async (): Promise<PermissionDecision> => ({
      permitted: true,
      organizationRole: null,
    }),
    checkScopeLineage: async (): Promise<AuthzScopeLineageResult> => ({ kind: "consistent" }),
    listUserCreatedRoles: async () => [],
    listBindingsForSynthesis: async (): Promise<AuthzBindingForSynthesis[]> => [],
    tryResolveScope: async (input: { projectId?: string; organizationId?: string }) =>
      input.projectId
        ? { type: "project", id: input.projectId }
        : input.organizationId
          ? { type: "organization", id: input.organizationId }
          : null,
    effectivePermissions: async () => ["project:view"],
  } as unknown as AuthzService;
}

/** The organization application the identity half owns, as `organization.*` reads it. */
function testOrganizationApp() {
  return {
    getAllForUser: vi.fn(async () => [{ id: ORGANIZATION_ID, name: "Acme" }]),
    isMember: vi.fn(async () => true),
  };
}

/**
 * The two collaborators the invitation half is composed over.
 */
async function composeApplication() {
  const prisma = testPrisma();
  const authz = testAuthz();
  const organizations = testOrganizationApp();
  const broadcast = new EventEmitter();
  const audit = { record: vi.fn(async () => undefined) };

  const projects = {
    getOrganizationId: vi.fn(async () => ORGANIZATION_ID),
    tryGetById: vi.fn(async () => ({ id: PROJECT_ID, firstMessage: true })),
    tryGetSummaryById: vi.fn(async () => ({ name: "Acme", slug: "acme" })),
  } as unknown as ProjectApi;

  const encryption = {
    encrypt: (value: string) => value,
    decrypt: (value: string) => value,
  } as never;

  const infrastructure = {
    ...stubInfrastructureEntitlements(),
    prisma: prisma.client,
    authz,
    audit,
  };

  const organizationFeature = await installApiOrganization({
    infrastructure,
    peers: {
      encryption,
    },
    rateLimit: async () => ({ allowed: true, resetAt: 0 }),
    baseHost: "https://app.langwatch.test",
    demoProject: { userId: "", projectId: "" },
    identity: createApiFixture<IdentityApi>(),
  });

  const projectFeature = await installApiProject({
    infrastructure,
    peers: {
      organizations,
      apiKeys: {} as unknown as ApiKeyApi,
      share: {} as unknown as ShareApi,
      topics: {
        getClusteringStatus: vi.fn(async () => ({ isRunInFlight: false })),
      } as unknown as TopicApi,
      encryption,
    },
  });

  const codingAgentFeature = await composeCodingAgentFeature({
    infrastructure,
    defaultRetentionDays: 90,
    peers: {
      projects,
      github: {} as unknown as GithubApi,
      // No ClickHouse: a coding-agent session is a projection there, so the
      // package's own null repositories answer emptily.
      clickHouse: null,
    },
  });

  const automationFeature = composeAutomationFeature({
    infrastructure,
    peers: {
      projects,
      monitors: { getAllByIds: vi.fn(async () => []) } as unknown as MonitorService,
      encryption,
      redis: null,
    },
    rateLimit: async () => ({ allowed: true, resetAt: 0 }),
    unsubscribeSecret: "0".repeat(64),
    baseHost: "https://app.langwatch.test",
    processName: "langwatch-api-test",
  });

  const enterpriseFeature = composeEnterpriseFeature({});

  const features = ApiTrpcFeaturesComposition.tryCompose({
    composed: {
      ...stubComposedFeatures(),
      organization: organizationFeature,
      project: projectFeature,
      codingAgent: codingAgentFeature,
      automation: automationFeature,
      enterprise: enterpriseFeature,
    },
    infrastructure,
    collaborators: stubCollaborators(
      {
        organizations: organizationFeature.app,
        projects: projectFeature.app,
        codingAgentApp: codingAgentFeature.app,
        automation: automationFeature.app,
        ...enterpriseFeature.application,
      },
      broadcast,
    ),
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

  return { application, features, prisma, authz, organizations, projects, audit };
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

/** What the wire says the failure was, whatever shape the envelope took. */
function refusal(body: unknown): string {
  return JSON.stringify(body);
}

describe("given an API process composed with the five tenant features", () => {
  describe("when the record is built", () => {
    it("mounts all nine tenant-administration namespaces", async () => {
      const { features } = await composeApplication();

      const record = features.build(stubMount());

      expect(
        TENANT_NAMESPACES.filter((namespace) => record[namespace as keyof typeof record]),
      ).toEqual(TENANT_NAMESPACES);
    });
  });

  describe("when the setup screen asks whether a project has its first trace", () => {
    it("answers through the project application this half composes", async () => {
      const { application, prisma } = await composeApplication();

      const { status, body } = await callTrpc(application, "project.getHasFirstMessage", {
        projectId: PROJECT_ID,
      });

      expect(status).toBe(200);
      expect(body).toMatchObject({ result: { data: { firstMessage: true } } });
      expect(prisma.project.findUnique).toHaveBeenCalled();
    });
  });

  describe("when the coding-agent page asks for a project's usage", () => {
    it("answers emptily on a process with no session storage", async () => {
      const { application } = await composeApplication();

      const { status } = await callTrpc(application, "codingAgents.usageTotals", {
        projectId: PROJECT_ID,
      });

      expect(status).toBe(200);
    });
  });

  describe("when a project lists its automations", () => {
    it("reads them through the composed automation application", async () => {
      const { application, prisma } = await composeApplication();

      const { status, body } = await callTrpc(application, "automation.getTriggers", {
        projectId: PROJECT_ID,
      });

      expect(status).toBe(200);
      expect(body).toMatchObject({ result: { data: [] } });
      expect(prisma.trigger.findMany).toHaveBeenCalled();
    });
  });

  describe("when a project lists the addresses that unsubscribed", () => {
    it("answers from the same automation application and records the read", async () => {
      const { application, audit } = await composeApplication();

      const { status } = await callTrpc(application, "emailSuppression.getAll", {
        projectId: PROJECT_ID,
      });

      expect(status).toBe(200);
      expect(audit.record).toHaveBeenCalled();
    });
  });

  describe("when no invitation service is composed", () => {
    it("refuses the pending-invite read by name rather than answering with none", async () => {
      const { application } = await composeApplication();

      const { body } = await callTrpc(application, "organization.getOrganizationPendingInvites", {
        organizationId: ORGANIZATION_ID,
      });

      expect(refusal(body)).toContain("service_unavailable");
    });
  });

  describe("when no protections resolver is composed", () => {
    it("refuses the field-redaction read by name rather than guessing", async () => {
      const { application } = await composeApplication();

      const { body } = await callTrpc(application, "project.getFieldRedactionStatus", {
        projectId: PROJECT_ID,
      });

      expect(refusal(body)).toContain("service_unavailable");
    });
  });

  describe("when no clustering scheduler runs in this process", () => {
    /**
     * The composition raises `service_unavailable` naming the scheduler, and
     * the project transport re-raises it untouched rather than swallowing a
     * knowable cause into a trace id. It still degrades event-store
     * internals a caller cannot act on — just not this refusal.
     */
    it("refuses the request by name rather than accepting a run nobody starts", async () => {
      const { application } = await composeApplication();

      const { body } = await callTrpc(
        application,
        "project.triggerTopicClustering",
        { projectId: PROJECT_ID },
        "mutation",
      );

      expect(refusal(body)).toContain("service_unavailable");
      expect(refusal(body)).not.toContain('"success":true');
    });
  });

  describe("when no Enterprise application is composed", () => {
    it("still mounts the licence surface, and refuses the read by name", async () => {
      const { application } = await composeApplication();

      const { body } = await callTrpc(application, "license.getStatus", {
        organizationId: ORGANIZATION_ID,
      });

      expect(refusal(body)).toContain("service_unavailable");
    });
  });
});
