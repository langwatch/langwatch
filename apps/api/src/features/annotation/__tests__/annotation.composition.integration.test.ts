/**
 * A reviewer's annotations, served by the API process.
 */
import type { AuthzApi } from "@langwatch/authz-contract";
import type { AgentApi } from "@langwatch/agent-contract";
import type { OrganizationApi } from "@langwatch/organization-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import type { ProjectApi } from "@langwatch/project-contract";
import { TraceEditOverlayService } from "@langwatch/trace-server";
import { PrismaTraceEditOverlayRepository } from "@langwatch/trace-server/composition/trace-edit-overlay";
import {
  applyOverlayToTrace,
  type Trace,
  type TraceEditOverlayPatch,
} from "@langwatch/trace-contract";
import { mapTraceToDatasetEntry } from "@langwatch/dataset-contract";
import type { TraceApi } from "@langwatch/trace-contract";
import type { UserApi } from "@langwatch/user-contract";
import { describe, expect, it, vi } from "vitest";
import { ApiApplication } from "../../../api.application.ts";
import { ApiTrpcFeaturesComposition } from "../../../app/api-trpc-features.composition.ts";
import {
  stubCollaborators,
  stubComposedFeatures,
  stubInfrastructureEntitlements,
} from "../../../app/__tests__/api-trpc-record.test-doubles.ts";
import { composeApiTraceProducerCommands } from "../../trace/trace-producer.composition.ts";
import { installApiAnnotation } from "../annotation.composition.ts";
import { ApiAnnotationUnavailableError } from "../annotation-absence.ts";

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

function testAuthz(): AuthzApi {
  return {
    hasPermission: async () => true,
    hasProjectPermission: async () => true,
    getDecision: async () => ({ permitted: true, organizationRole: null }),
    getProjectAnyDecision: async () => ({ permitted: true, organizationRole: null }),
    checkScopeLineage: async () => ({ kind: "consistent" }),
  } as unknown as AuthzApi;
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
  const traceCommands = composeApiTraceProducerCommands({
    eventing: undefined,
    processName: "langwatch-api",
  });

  const overlays = TraceEditOverlayService.create(PrismaTraceEditOverlayRepository.create(prisma));

  const traces = {
    async findExistingTraceIds(input: { projectId: string; traceIds: readonly string[] }) {
      const client = await clickHouse.resolveClient(input.projectId);

      const result = await client.query({
        query: "",
        query_params: { tenantId: input.projectId, traceIds: [...input.traceIds] },
      });

      const rows = await result.json();

      return rows.map(({ TraceId }) => TraceId);
    },
    loadTraces: () =>
      Promise.reject(
        new ApiAnnotationUnavailableError(
          "trace read pipeline, so it cannot resolve the traces behind an annotation queue",
        ),
      ),
    async writeSuggestion(input: {
      projectId: string;
      traceId: string;
      target:
        | { kind: "span"; spanId: string; field: "input" | "output" }
        | {
            kind: "trace";
            field: "input" | "output";
          };
      text: string;
      userId: string;
    }) {
      if (input.target.kind === "span") {
        const scope = {
          projectId: input.projectId,
          traceId: input.traceId,
          spanId: input.target.spanId,
          userId: input.userId,
          field: input.target.field,
        };

        if (input.text.length === 0) {
          await overlays.tryRemoveSpanFieldEdit(scope);
        } else {
          await overlays.mergeSpanFieldEdit({ ...scope, text: input.text });
        }

        return;
      }

      const scope = {
        projectId: input.projectId,
        traceId: input.traceId,
        userId: input.userId,
        field: input.target.field,
      };

      if (input.text.length === 0) {
        await overlays.tryRemoveTraceIOEdit(scope);
      } else {
        await overlays.mergeTraceIOEdit({ ...scope, value: input.text });
      }
    },
    recordAnnotation: (input: Parameters<typeof traceCommands.add>[0]) => traceCommands.add(input),
    removeAnnotation: (input: Parameters<typeof traceCommands.remove>[0]) =>
      traceCommands.remove(input),
  } as unknown as TraceApi;

  return installApiAnnotation({
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
      } as unknown as ProjectApi,
      organizations: createApiFixture<OrganizationApi>({
        getOrganizationMembers: async () => [],
        getAllMembers: async () => [],
      }),
      users: { getProfiles: async () => [] } as unknown as UserApi,
      traces,
      permissions: testAuthz(),
    },
  });
}

async function composeApplication() {
  const prisma = testPrisma();
  const clickHouse = testClickHouse(["trace-a"]);
  const annotation = await composeAnnotation(prisma.client, clickHouse);

  const features = ApiTrpcFeaturesComposition.tryCompose({
    composed: { ...stubComposedFeatures(), annotation },
    infrastructure: {
      ...stubInfrastructureEntitlements(),
      prisma: prisma.client,
      authz: testAuthz(),
      audit: undefined,
    },
    collaborators: stubCollaborators({
      annotation: annotation.app,
    }),
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
      const { application, prisma, clickHouse } = await composeApplication();

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
      const { application, prisma } = await composeApplication();
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
      const { application } = await composeApplication();

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
