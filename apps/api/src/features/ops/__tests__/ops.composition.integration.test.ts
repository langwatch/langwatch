/**
 * The operator back office, composed as its own feature by the API process.
 */
import type { AuthService } from "@langwatch/auth-contract";
import type {
  AuthzGetDecisionInput,
  AuthzScopeLineageResult,
  AuthzService,
  PermissionDecision,
} from "@langwatch/authz-contract";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import type { ProjectService } from "@langwatch/project-contract";
import type { UserService } from "@langwatch/user-contract";
import { describe, expect, it, vi } from "vitest";
import {
  ApiApplication,
  MissingAgentService,
  MissingSecretService,
} from "../../../api.application";
import { ApiTrpcFeaturesComposition } from "../../../app/api-trpc-features.composition";
import {
  stub,
  stubCollaborators,
  stubComposedFeatures,
  stubInfrastructureEntitlements,
} from "../../../app/__tests__/api-trpc-record.test-doubles";
import { composeOpsFeature } from "../ops.composition";

const SESSION_USER = {
  id: "user-1",
  name: "Sam Rivers",
  email: "operator@acme.test",
  role: "ADMIN",
};

/**
 * The install's shared ClickHouse endpoint, as the event-log explorer reaches
 * it: one `query` call, and the SQL it was handed recorded so the test can say
 * which table the composed repository read.
 */
type FakeEventLogClient = {
  asked: string[];
  query: (params: { query: string }) => Promise<{ json(): Promise<unknown> }>;
};

function eventLogClient(rows: unknown[]): FakeEventLogClient {
  const asked: string[] = [];
  return {
    asked,
    query: async ({ query }) => {
      asked.push(query);
      return { json: async () => rows };
    },
  };
}

/** Permits everything: the refusal path is the operator check's own business. */
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
    tryResolveScope: async (input: { projectId?: string; organizationId?: string }) =>
      input.projectId ? { type: "project", id: input.projectId } : null,
    effectivePermissions: async () => [],
  } as unknown as AuthzService;
}

function composeApplication(
  options: { adminEmails?: readonly string[]; eventLogClient?: FakeEventLogClient } = {},
) {
  // The operator's scheduled-job read is a cross-tenant `$queryRaw` scan, so it
  // reaches the client rather than a model delegate. An empty result is a real
  // answer for a deployment that has scheduled nothing.
  const prisma = { $queryRaw: vi.fn(async () => []) } as unknown as PrismaClient;
  const authz = testAuthz();
  const infrastructure = {
    ...stubInfrastructureEntitlements(),
    prisma,
    authz,
    audit: undefined,
  };

  const ops = composeOpsFeature({
    infrastructure,
    peers: {
      users: stub<UserService>("users"),
      auth: stub<AuthService>("auth"),
      projects: stub<ProjectService>("projects"),
    },
    adminEmails: options.adminEmails ?? [SESSION_USER.email],
    // Absent by default: the explorer then refuses by name rather than
    // answering the empty set.
    eventLogClient: (options.eventLogClient ?? null) as never,
    eventing: undefined,
  });

  const features = ApiTrpcFeaturesComposition.tryCompose({
    composed: { ...stubComposedFeatures(), ops },
    infrastructure,
    collaborators: stubCollaborators({
      ops: ops.app,
    }),
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

describe("given the API process composed the operator feature from its own graph", () => {
  describe("when each operator surface is called through the real /api/trpc handler", () => {
    it("resolves the operator scope from this process's own allow-list", async () => {
      const { application } = composeApplication();

      const { status, body } = await callTrpc(application, "ops.getScope", {});

      expect(status).toBe(200);
      expect(body).toMatchObject({ result: { data: { json: { scope: { kind: "platform" } } } } });
    });

    it("reads the scheduled-job store rather than refusing it by name", async () => {
      const { application } = composeApplication();

      const { status, body } = await callTrpc(application, "ops.listScheduledJobs", { limit: 20 });

      // An empty list is the honest answer for a deployment that has scheduled
      // nothing; a refusal was not.
      expect(status).toBe(200);
      expect(JSON.stringify(body)).not.toContain("scheduled-job store");
    });

    /** @scenario "The operator searches the event log through the composed explorer" */
    it("searches the event log rather than refusing it by name", async () => {
      const client = eventLogClient([
        {
          aggregateId: "conversation-42",
          aggregateType: "langy-conversation",
          tenantId: "project-1",
          eventCount: "7",
          lastEventTime: "1756800000000",
        },
      ]);
      const { application } = composeApplication({ eventLogClient: client });

      const { status, body } = await callTrpc(application, "ops.searchAggregates", {
        query: "conversation-42",
      });

      expect(status).toBe(200);
      expect(client.asked).toHaveLength(1);
      expect(client.asked[0]).toContain("FROM event_log");
      expect(JSON.stringify(body)).toContain("conversation-42");
      expect(JSON.stringify(body)).not.toContain("the event-log explorer");
    });
  });

  describe("when a capability this process did not compose is reached", () => {
    /** @scenario "An install with no shared endpoint refuses the search by name" */
    it("names the event-log explorer when this deployment has no shared endpoint", async () => {
      const { application } = composeApplication();

      const { status, body } = await callTrpc(application, "ops.searchAggregates", {
        query: "conversation-42",
      });

      // A deployment holding only private routes has no install-wide event log
      // to search, and refusing beats answering the empty set, which would read
      // as "this install has recorded nothing". The capability NAME reaches the
      // log rather than the wire — tRPC replaces a handled message with its
      // code slug — so what is observable here is the refusal itself.
      expect(status).toBeGreaterThanOrEqual(400);
      expect(JSON.stringify(body)).toContain("service_unavailable");
    });

    it("keeps a caller who is not on the allow-list out of the operator surface", async () => {
      const { application } = composeApplication({ adminEmails: ["someone-else@acme.test"] });

      const { body } = await callTrpc(application, "ops.getScope", {});

      // The PROBE variant: it reports "no access" rather than refusing, which is
      // what lets the global menu poll it on every page load.
      expect(body).toMatchObject({ result: { data: { json: { scope: { kind: "none" } } } } });
    });
  });
});
