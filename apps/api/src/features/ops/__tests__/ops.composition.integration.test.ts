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
import type { ApiKeyApi } from "@langwatch/api-key-contract";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import type { ProjectService } from "@langwatch/project-contract";
import type { UserService } from "@langwatch/user-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it, vi } from "vitest";
import {
  stub,
  stubInfrastructureEntitlements,
} from "../../../app/__tests__/api-trpc-record.test-doubles.ts";
import { composeOpsFeature } from "../ops.composition.ts";

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

/**
 * The composed operator application. `ops.*` is off the tRPC record while the
 * module's transport is unconverted, so each surface below is called on the
 * application the process installed rather than through `/api/trpc`.
 */
async function composeOperatorApp(
  options: { adminEmails?: readonly string[]; eventLogClient?: FakeEventLogClient } = {},
) {
  // The operator's scheduled-job read is a cross-tenant `$queryRaw` scan, so it
  // reaches the client rather than a model delegate. An empty result is a real
  // answer for a deployment that has scheduled nothing.
  // The process-manager delegates are named because the fleet explorer is
  // composed over the same client; nothing in this suite reads them.
  const prisma = {
    $queryRaw: vi.fn(async () => []),
    $executeRaw: vi.fn(async () => 0),
    $transaction: vi.fn(async () => []),
    processManagerInbox: {},
    processManagerInstance: {},
    processManagerOutbox: {},
    processManagerOutboxAttempt: {},
  } as unknown as PrismaClient;
  const infrastructure = {
    ...stubInfrastructureEntitlements(),
    prisma,
    authz: testAuthz(),
    audit: undefined,
  };

  const ops = await composeOpsFeature({
    infrastructure,
    peers: {
      users: stub<UserService>("users"),
      auth: stub<AuthService>("auth"),
      projects: stub<ProjectService>("projects"),
      apiKeys: createApiFixture<ApiKeyApi>(),
    },
    adminEmails: options.adminEmails ?? [SESSION_USER.email],
    rateLimit: () => Promise.resolve({ allowed: true }),
    // Absent by default: the explorer then refuses by name rather than
    // answering the empty set.
    eventLogClient: (options.eventLogClient ?? null) as never,
    eventing: undefined,
  });

  return ops.app;
}

describe("given the API process composed the operator feature from its own graph", () => {
  describe("when each operator surface is called on the composed application", () => {
    it("resolves the operator scope from this process's own allow-list", async () => {
      const app = await composeOperatorApp();

      expect(app.isAdmin({ email: SESSION_USER.email })).toBe(true);
    });

    it("reads the scheduled-job store rather than refusing it by name", async () => {
      const app = await composeOperatorApp();

      // An empty list is the honest answer for a deployment that has scheduled
      // nothing; a refusal was not.
      await expect(app.listScheduledJobs({ limit: 20 })).resolves.toEqual([]);
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
      const app = await composeOperatorApp({ eventLogClient: client });

      const found = await app.searchAggregates({ query: "conversation-42", tenantIds: [] });

      expect(client.asked).toHaveLength(1);
      expect(client.asked[0]).toContain("FROM event_log");
      expect(JSON.stringify(found)).toContain("conversation-42");
    });
  });

  describe("when a capability this process did not compose is reached", () => {
    /** @scenario "An install with no shared endpoint refuses the search by name" */
    it("names the event-log explorer when this deployment has no shared endpoint", async () => {
      const app = await composeOperatorApp();

      // A deployment holding only private routes has no install-wide event log
      // to search, and refusing beats answering the empty set, which would read
      // as "this install has recorded nothing".
      await expect(
        app.searchAggregates({ query: "conversation-42", tenantIds: [] }),
      ).rejects.toThrow(/event-log explorer/);
    });

    it("keeps a caller who is not on the allow-list out of the operator surface", async () => {
      const app = await composeOperatorApp({ adminEmails: ["someone-else@acme.test"] });

      expect(app.isAdmin({ email: SESSION_USER.email })).toBe(false);
    });
  });
});
