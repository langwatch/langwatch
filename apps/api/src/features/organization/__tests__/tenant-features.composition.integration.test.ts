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
import type { ApiKeyService } from "@langwatch/api-key-contract";
import type { GithubService } from "@langwatch/github-contract";
import type { MonitorService } from "@langwatch/monitor-contract";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import type { ProjectService } from "@langwatch/project-contract";
import type { ShareService } from "@langwatch/share-contract";
import type { TopicService } from "@langwatch/topic-contract";
import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import {
  ApiApplication,
  MissingAgentService,
  MissingSecretService,
} from "../../../api.application";
import { ApiTrpcFeaturesComposition } from "../../../app/api-trpc-features.composition";
import { composeAutomationFeature } from "../../automation/automation.composition";
import { composeCodingAgentFeature } from "../../coding-agent/coding-agent.composition";
import { composeEnterpriseFeature } from "../../enterprise/enterprise.composition";
import { composeProjectFeature } from "../../project/project.composition";
import { composeOrganizationFeature } from "../organization.composition";
import {
  stubCollaborators,
  stubComposedFeatures,
  stubInfrastructureEntitlements,
  stubMount,
} from "../../../app/__tests__/api-trpc-record.test-doubles";

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

/** The rows this half actually reads, as a double. */
function testPrisma() {
  const client = {
    project: {
      findUnique: vi.fn(async () => ({ id: PROJECT_ID, firstMessage: true })),
      findFirst: vi.fn(async () => ({ id: PROJECT_ID, firstMessage: true })),
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

  const held = client as unknown as { trigger: { findMany: ReturnType<typeof vi.fn> } };
  return { client, trigger: held.trigger };
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
function composeApplication(options: { withInvitations?: boolean } = {}) {
  const prisma = testPrisma();
  const authz = testAuthz();
  const organizations = testOrganizationApp();
  const broadcast = new EventEmitter();
  const audit = { record: vi.fn(async () => undefined) };

  const projects = {
    getOrganizationId: vi.fn(async () => ORGANIZATION_ID),
    tryGetById: vi.fn(async () => ({ id: PROJECT_ID, firstMessage: true })),
    tryGetSummaryById: vi.fn(async () => ({ name: "Acme", slug: "acme" })),
  } as unknown as ProjectService;

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

  const organizationFeature = composeOrganizationFeature({
    infrastructure,
    peers: {
      encryption,
      ...(options.withInvitations
        ? {
            authzGrants: {
              grant: vi.fn(async () => undefined),
              revoke: vi.fn(async () => undefined),
            } as never,
            roles: { listAssignableCustomRoles: vi.fn(async () => []) } as never,
          }
        : {}),
    },
    rateLimit: async () => ({ allowed: true, resetAt: 0 }),
    baseHost: "https://app.langwatch.test",
    demoProject: { userId: "", projectId: "" },
  });

  const projectFeature = composeProjectFeature({
    infrastructure,
    peers: {
      projects,
      apiKeys: {} as unknown as ApiKeyService,
      share: {} as unknown as ShareService,
      topics: {
        getClusteringStatus: vi.fn(async () => ({ isRunInFlight: false })),
      } as unknown as TopicService,
      encryption,
    },
  });

  const codingAgentFeature = composeCodingAgentFeature({
    infrastructure,
    peers: {
      projects,
      github: {} as unknown as GithubService,
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

  const enterpriseFeature = composeEnterpriseFeature({ audit });

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

  const invites = (
    prisma.client as unknown as {
      organizationInvite: { findMany: ReturnType<typeof vi.fn> };
    }
  ).organizationInvite;

  return { application, features, prisma, authz, organizations, projects, audit, invites };
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
          body: JSON.stringify({ json: input }),
        })
      : await application.hono.request(
          `${url}?input=${encodeURIComponent(JSON.stringify({ json: input }))}`,
        );
  return { status: response.status, body: await response.json() };
}

/** What the wire says the failure was, whatever shape the envelope took. */
function refusal(body: unknown): string {
  return JSON.stringify(body);
}

describe("given an API process composed with the five tenant features", () => {
  describe("when the record is built", () => {
    it("mounts all nine tenant-administration namespaces", () => {
      const { features } = composeApplication();

      const record = features.build(stubMount());

      expect(
        TENANT_NAMESPACES.filter((namespace) => record[namespace as keyof typeof record]),
      ).toEqual(TENANT_NAMESPACES);
    });
  });

  describe("when the setup screen asks whether a project has its first trace", () => {
    it("answers through the project application this half composes", async () => {
      const { application, projects } = composeApplication();

      const { status, body } = await callTrpc(application, "project.getHasFirstMessage", {
        projectId: PROJECT_ID,
      });

      expect(status).toBe(200);
      expect(body).toMatchObject({ result: { data: { json: { firstMessage: true } } } });
      expect(projects.tryGetById).toHaveBeenCalledWith(PROJECT_ID);
    });
  });

  describe("when the coding-agent page asks for a project's usage", () => {
    it("answers emptily on a process with no session storage", async () => {
      const { application } = composeApplication();

      const { status } = await callTrpc(application, "codingAgents.usageTotals", {
        projectId: PROJECT_ID,
      });

      expect(status).toBe(200);
    });
  });

  describe("when a project lists its automations", () => {
    it("reads them through the composed automation application", async () => {
      const { application, prisma } = composeApplication();

      const { status, body } = await callTrpc(application, "automation.getTriggers", {
        projectId: PROJECT_ID,
      });

      expect(status).toBe(200);
      expect(body).toMatchObject({ result: { data: { json: [] } } });
      expect(prisma.trigger.findMany).toHaveBeenCalled();
    });
  });

  describe("when a project lists the addresses that unsubscribed", () => {
    it("answers from the same automation application and records the read", async () => {
      const { application, audit } = composeApplication();

      const { status } = await callTrpc(application, "emailSuppression.getAll", {
        projectId: PROJECT_ID,
      });

      expect(status).toBe(200);
      expect(audit.record).toHaveBeenCalled();
    });
  });

  describe("when no invitation service is composed", () => {
    it("refuses the pending-invite read by name rather than answering with none", async () => {
      const { application } = composeApplication();

      const { body } = await callTrpc(application, "organization.getOrganizationPendingInvites", {
        organizationId: ORGANIZATION_ID,
      });

      expect(refusal(body)).toContain("service_unavailable");
    });
  });

  describe("when the grant ledger and the role service are composed", () => {
    /**
     * The absence above is closed by this process building the service itself rather than by a host injecting one. What that has to prove is that the read
     * reaches the ROW — a port that answered `[]` would pass a test which only checked the call stopped refusing, and an empty invitation list is the one
     * answer an administrator acts on by inviting the same person twice.
     */
    it("answers the pending-invite read from the invitation rows", async () => {
      const { application, invites } = composeApplication({ withInvitations: true });

      const { status, body } = await callTrpc(
        application,
        "organization.getOrganizationPendingInvites",
        { organizationId: ORGANIZATION_ID },
      );

      expect(status).toBe(200);
      expect(refusal(body)).not.toContain("service_unavailable");
      expect(refusal(body)).toContain("newcomer@acme.test");
      expect(invites.findMany).toHaveBeenCalled();
    });

    /**
     * The acceptance link is the thing an administrator hands somebody when no mail gateway is composed, and it
     * is minted from the deployment's public origin. A link built against a default host would look right in the
     * listing and open nothing.
     */
    it("carries an acceptance link on this deployment's own origin", async () => {
      const { application } = composeApplication({ withInvitations: true });

      const { body } = await callTrpc(application, "organization.getOrganizationPendingInvites", {
        organizationId: ORGANIZATION_ID,
      });

      expect(refusal(body)).toContain("https://app.langwatch.test/invite/accept?inviteCode=code-1");
    });
  });

  describe("when no protections resolver is composed", () => {
    it("refuses the field-redaction read by name rather than guessing", async () => {
      const { application } = composeApplication();

      const { body } = await callTrpc(application, "project.getFieldRedactionStatus", {
        projectId: PROJECT_ID,
      });

      expect(refusal(body)).toContain("service_unavailable");
    });
  });

  describe("when no clustering scheduler runs in this process", () => {
    /**
     * The composition raises `service_unavailable` naming the scheduler, and the project transport re-raises it untouched: the cause is known — this process composes no clustering wake path — and the caller
     * can act on it, so the name reaches the wire instead of a trace id for a condition we could have named. The transport's deliberate degradation is still there underneath it, and still covers the
     * event-store internals a caller cannot act on; it just no longer swallows the refusal above them.
     */
    it("refuses the request by name rather than accepting a run nobody starts", async () => {
      const { application } = composeApplication();

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
      const { application } = composeApplication();

      const { body } = await callTrpc(application, "license.getStatus", {
        organizationId: ORGANIZATION_ID,
      });

      expect(refusal(body)).toContain("service_unavailable");
    });
  });
});
