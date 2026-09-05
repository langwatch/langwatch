/**
 * A reviewer's annotations, served by the API process.
 *
 * What this pins is the queueing path over the REAL `/api/trpc` handler on
 * THIS process's root, through THIS process's policy chain, against what
 * `composeAnnotationFeature` produced — including the answer that is trace
 * storage's rather than Annotation's: which of the ids sent address a trace
 * this project holds.
 *
 * And one named absence, because an absence nobody can observe is
 * indistinguishable from a stub: with no trace read pipeline composed, the
 * reviewer's trace content is refused by name rather than answered as an empty
 * queue, which would tell a reviewer their work was done.
 */
import type { AuthzService } from "@langwatch/authz-contract";
import type { OrganizationService } from "@langwatch/organization-contract";
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
  stubApplicationSlices,
  stubCollaborators,
  stubComposedFeatures,
  stubInfrastructureEntitlements,
} from "../../../app/__tests__/api-trpc-record.test-doubles";
import { composeApiTraceProducerCommands } from "../../trace/trace-producer.composition";
import { composeAnnotationFeature } from "../annotation.composition";

const SESSION_USER = { id: "user-1", name: "Sam Rivers", email: "sam@acme.test", role: "ADMIN" };
const PROJECT_ID = "project-1";
const ORGANIZATION_ID = "organization-1";
const TEAM_ID = "team-1";

/**
 * The rows the queueing writes, recorded.
 *
 * A double rather than a database, and the assertion is on the WRITE rather
 * than only on the returned object: what the move has to preserve is which
 * rows are touched.
 */
function testPrisma() {
  const queueItemWrites: Array<Record<string, unknown>[]> = [];

  const transaction = {
    annotationQueueItem: {
      createMany: vi.fn(async ({ data }: { data: Record<string, unknown>[] }) => {
        queueItemWrites.push(data);
        return { count: data.length };
      }),
      updateMany: vi.fn(async () => ({ count: 0 })),
    },
    annotationQueueItemUser: {
      createMany: vi.fn(async () => ({ count: 0 })),
      updateMany: vi.fn(async () => ({ count: 0 })),
    },
  };

  const client = {
    $transaction: vi.fn(async (run: (tx: typeof transaction) => Promise<unknown>) =>
      typeof run === "function" ? await run(transaction) : undefined,
    ),
    project: {
      findUnique: vi.fn(async () => ({
        id: PROJECT_ID,
        name: "Acme production",
        teamId: TEAM_ID,
        team: { organizationId: ORGANIZATION_ID },
      })),
    },
    annotationQueue: { count: vi.fn(async () => 1) },
    annotationQueueItem: { findMany: vi.fn(async () => []) },
  } as unknown as PrismaClient;

  return { client, queueItemWrites, transaction };
}

function testAuthz(): AuthzService {
  return {
    hasPermission: async () => true,
    getDecision: async () => ({ permitted: true, organizationRole: null }),
    getProjectAnyDecision: async () => ({ permitted: true, organizationRole: null }),
    checkScopeLineage: async () => ({ kind: "consistent" }),
  } as unknown as AuthzService;
}

/** The one statement shape the trace-existence read issues. */
type TraceExistenceQuery = Readonly<{
  query: string;
  query_params: Readonly<{ tenantId: string; traceIds: string[] }>;
}>;

/** ClickHouse holding exactly one of the two ids the caller will send. */
function testClickHouse(existing: readonly string[]) {
  const query = vi.fn(async (_statement: TraceExistenceQuery) => ({
    json: async () => existing.map((TraceId) => ({ TraceId })),
  }));
  return {
    query,
    resolveClient: async () => ({ query }) as never,
  };
}

function composeAnnotation(prisma: PrismaClient, clickHouse: ReturnType<typeof testClickHouse>) {
  return composeAnnotationFeature({
    infrastructure: {
      ...stubInfrastructureEntitlements(),
      prisma,
      authz: testAuthz(),
      audit: undefined,
    },
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
      users: { getProfiles: async () => [] } as unknown as UserService,
      // No queue: the two trace-side markers refuse by name, which is the
      // composition's stated absence and not a path this file drives.
      traceCommands: composeApiTraceProducerCommands({
        eventing: undefined,
        processName: "langwatch-api",
      }),
    },
    resolveClickHouseClient: clickHouse.resolveClient,
  });
}

function composeApplication() {
  const prisma = testPrisma();
  const clickHouse = testClickHouse(["trace-a"]);
  const annotation = composeAnnotation(prisma.client, clickHouse);

  const features = ApiTrpcFeaturesComposition.tryCompose({
    composed: { ...stubComposedFeatures(), annotation },
    infrastructure: {
      ...stubInfrastructureEntitlements(),
      prisma: prisma.client,
      authz: testAuthz(),
      audit: undefined,
    },
    collaborators: stubCollaborators({
      annotations: annotation.app,
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

  return { application, prisma, clickHouse };
}

async function callTrpc(
  application: ApiApplication,
  path: string,
  input: Record<string, unknown>,
  method: "query" | "mutation" = "mutation",
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

describe("given an API process composed with the annotation feature", () => {
  describe("when traces are queued for annotation", () => {
    /** @scenario "An id no trace answers to is never queued for review" */
    it("queues only the ids trace storage answers to", async () => {
      const { application, prisma, clickHouse } = composeApplication();

      const { status, body } = await callTrpc(application, "annotation.createQueueItem", {
        projectId: PROJECT_ID,
        traceIds: ["trace-a", "trace-b"],
        annotators: ["queue-q1"],
      });

      expect(status).toBe(200);
      expect(body).toMatchObject({ result: { data: { json: { created: 1, skipped: 1 } } } });

      // The existence answer came from trace storage, scoped by tenant, and it
      // is what decided the write.
      expect(clickHouse.query).toHaveBeenCalledTimes(1);
      expect(clickHouse.query).toHaveBeenCalledWith(
        expect.objectContaining({
          query_params: { tenantId: PROJECT_ID, traceIds: ["trace-a", "trace-b"] },
        }),
      );
      expect(prisma.queueItemWrites).toEqual([
        [
          {
            annotationQueueId: "q1",
            traceId: "trace-a",
            projectId: PROJECT_ID,
            createdByUserId: SESSION_USER.id,
          },
        ],
      ]);
    });
  });

  describe("when the deployment composed no trace read pipeline", () => {
    /** @scenario "A capability the deployment does not hold refuses by name" */
    it("refuses the reviewer's trace content by name rather than answering an empty queue", async () => {
      const { application } = composeApplication();

      const { status, body } = await callTrpc(
        application,
        "annotation.getQueueItems",
        { projectId: PROJECT_ID },
        "query",
      );

      expect(status).toBeGreaterThanOrEqual(400);
      expect(JSON.stringify(body)).toContain("service_unavailable");
    });
  });
});
