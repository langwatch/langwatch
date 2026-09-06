/**
 * A reviewer's annotations, served by the API process.
 */
import type { AuthzService } from "@langwatch/authz-contract";
import type { OrganizationService } from "@langwatch/organization-contract";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import type { ProjectService } from "@langwatch/project-contract";
import {
  applyOverlayToTrace,
  mapTraceToDatasetEntry,
  type Trace,
  type TraceEditOverlayPatch,
} from "@langwatch/trace-contract";
import type { UserService } from "@langwatch/user-contract";
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
import { composeApiTraceProducerCommands } from "../../trace/trace-producer.composition";
import { composeAnnotationFeature } from "../annotation.composition";

const SESSION_USER = { id: "user-1", name: "Sam Rivers", email: "sam@acme.test", role: "ADMIN" };
const PROJECT_ID = "project-1";
const ORGANIZATION_ID = "organization-1";
const TEAM_ID = "team-1";

/**
 * The rows the queueing writes, recorded.
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

  // The one correction row the suggestion writes, kept as the store would keep
  // it: the overlay service reads it back and merges into it.
  const overlays = new Map<
    string,
    { id: string; projectId: string; traceId: string; patch: unknown }
  >();
  const overlayKey = (projectId: string, traceId: string) => `${projectId}/${traceId}`;

  const client = {
    $transaction: vi.fn(async (run: (tx: typeof transaction) => Promise<unknown>) =>
      typeof run === "function" ? await run(transaction) : undefined,
    ),
    annotation: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({
        ...data,
        userId: data.userId ?? null,
        email: data.email ?? null,
        createdAt: new Date(),
        updatedAt: new Date(),
      })),
    },
    traceEditOverlay: {
      findUnique: vi.fn(
        async ({
          where,
        }: {
          where: { projectId_traceId: { projectId: string; traceId: string } };
        }) =>
          overlays.get(
            overlayKey(where.projectId_traceId.projectId, where.projectId_traceId.traceId),
          ) ?? null,
      ),
      upsert: vi.fn(
        async ({
          where,
          create,
          update,
        }: {
          where: { projectId_traceId: { projectId: string; traceId: string } };
          create: Record<string, unknown>;
          update: Record<string, unknown>;
        }) => {
          const key = overlayKey(
            where.projectId_traceId.projectId,
            where.projectId_traceId.traceId,
          );
          const existing = overlays.get(key);
          const row = { ...(existing ?? create), ...update } as {
            id: string;
            projectId: string;
            traceId: string;
            patch: unknown;
          };
          overlays.set(key, row);
          return row;
        },
      ),
    },
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

  return { client, queueItemWrites, transaction, overlays, overlayKey };
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
          body: JSON.stringify(input),
        })
      : await application.hono.request(`${url}?input=${encodeURIComponent(JSON.stringify(input))}`);
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
      expect(body).toMatchObject({ result: { data: { created: 1, skipped: 1 } } });

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

  describe("when a reviewer suggests what a span should have answered", () => {
    /** @scenario "A field suggested through a comment reaches the dataset" */
    it("carries the suggested output into the dataset row for that span", async () => {
      const { application, prisma } = composeApplication();
      const traceId = "trace-span-suggestion-dataset";

      const { status } = await callTrpc(application, "annotation.create", {
        projectId: PROJECT_ID,
        traceId,
        comment: "this search should have found Amsterdam",
        scoreOptions: {},
        anchorKind: "field",
        anchorId: "span-search",
        anchorPath: "output",
        expectedOutput: "Amsterdam",
      });
      expect(status).toBe(200);

      const capturedTrace = {
        trace_id: traceId,
        project_id: PROJECT_ID,
        metadata: {},
        timestamps: { started_at: 1_000, inserted_at: 1_000, updated_at: 1_000 },
        input: { value: "what is the capital of the Netherlands?" },
        output: { value: "Rotterdam" },
        spans: [
          {
            span_id: "span-search",
            trace_id: traceId,
            project_id: PROJECT_ID,
            type: "tool",
            name: "search",
            input: { type: "text", value: "capital of the Netherlands" },
            output: { type: "text", value: "Rotterdam" },
            timestamps: { started_at: 1_000, finished_at: 1_100 },
          },
        ],
      } as unknown as Trace;

      const stored = prisma.overlays.get(prisma.overlayKey(PROJECT_ID, traceId));
      const corrected = applyOverlayToTrace({
        trace: capturedTrace,
        patch: stored?.patch as TraceEditOverlayPatch,
      });

      const [row] = mapTraceToDatasetEntry(
        corrected as never,
        { answer: { source: "spans", key: "search", subkey: "output" } },
        new Set(),
      );

      expect(JSON.stringify(row?.answer)).toContain("Amsterdam");
      expect(JSON.stringify(row?.answer)).not.toContain("Rotterdam");
      // The captured trace is never rewritten: the correction is an overlay.
      expect(capturedTrace.spans?.[0]?.output).toEqual({ type: "text", value: "Rotterdam" });
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
