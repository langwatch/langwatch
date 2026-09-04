/**
 * @vitest-environment node
 *
 * The `annotation.create` mutation's two side effects that are the router's
 * OWN logic (not the storage repository's): carrying a changed suggestion
 * into the trace correction before saving, and syncing every comment (span
 * or field anchored included) onto the trace so the has-annotation filter
 * sees it. Host ports (`writeTraceSuggestion`, `recordAnnotationOnTrace`,
 * `loadTraces`, queue persistence) are faked; `ctx.app.annotations` is a
 * real `AnnotationApp` over real Postgres.
 *
 * specs/traces-v2/anchored-comments.feature.
 */
import { initTRPC } from "@trpc/server";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanupTestRows } from "@langwatch/test-harness";
import {
  PrismaConfigService,
  PrismaConnectionService,
  PrismaQueryGuard,
  type PrismaQueryContext,
  type PrismaQueryExecutor,
} from "@langwatch/prisma-client";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import {
  annotationApiCreateInputSchema,
  annotationApiOptimizedQueuesInputSchema,
} from "@langwatch/annotation-contract";
import { AnnotationApp } from "../../../app/annotation.app";
import { PostgresAnnotationAdapter } from "../../../adapters/postgres.annotation.adapter";
import {
  createAnnotationTestOrganizations,
  createAnnotationTestProjects,
} from "../../../adapters/__tests__/support/annotation-test-services";
import {
  AnnotationTrpcApi,
  type AnnotationTrpcContext,
  type AnnotationTrpcPorts,
} from "../annotation.api";

class AllowTestQueries extends PrismaQueryGuard {
  execute(context: PrismaQueryContext, next: PrismaQueryExecutor): Promise<unknown> {
    return next(context.args);
  }
}

const databaseUrl = process.env.LANGWATCH_TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const connection = databaseUrl
  ? PrismaConnectionService.create({ guard: new AllowTestQueries() }).connect(
      PrismaConfigService.create().resolve({ databaseUrl, log: ["error"] }),
    )
  : null;
const prisma = connection?.client as PrismaClient;

const projectId = "test-project-id";

describe.skipIf(!databaseUrl)("annotation.create suggestion carry-over and trace sync", () => {
  const annotationService = PostgresAnnotationAdapter.create({
    database: prisma,
    projects: createAnnotationTestProjects(),
    organizations: createAnnotationTestOrganizations(),
  }).build();
  const app = AnnotationApp.create({
    annotations: annotationService,
    users: { getProfiles: async () => [] },
  });

  const mockWriteTraceSuggestion = vi.fn(async () => undefined);
  const mockRecordAnnotationOnTrace = vi.fn(async () => undefined);
  const mockRemoveAnnotationFromTrace = vi.fn(async () => undefined);
  const mockLoadTraces = vi.fn(async () => []);
  const mockProbeProjectPermission = vi.fn(async () => true);

  const ports: AnnotationTrpcPorts = {
    queues: () => {
      throw new Error("not used by these tests");
    },
    probeProjectPermission: mockProbeProjectPermission,
    writeTraceSuggestion: mockWriteTraceSuggestion,
    loadTraces: mockLoadTraces,
    recordAnnotationOnTrace: mockRecordAnnotationOnTrace,
    removeAnnotationFromTrace: mockRemoveAnnotationFromTrace,
  } as unknown as AnnotationTrpcPorts;

  function harness() {
    const trpc = initTRPC.context<AnnotationTrpcContext>().create();
    const router = AnnotationTrpcApi.create(
      trpc,
      {
        protected: trpc.procedure,
        policy: () => (procedure) => procedure,
      },
      ports,
    );
    return router.createCaller({
      app: { annotations: app },
      actor: () => ({ id: "test-user-annotation-suggestion" }),
    });
  }

  const spanSuggestionTraceId = `test-trace-annotation-suggestion-${nanoid()}`;
  const spanOnlyTraceId = `test-trace-annotation-span-only-${nanoid()}`;

  afterAll(async () => {
    await cleanupTestRows(prisma, [
      ["annotation", { projectId, traceId: spanSuggestionTraceId }],
      ["annotation", { projectId, traceId: spanOnlyTraceId }],
    ]);
  });

  describe("given a comment on a span's output carrying a suggestion", () => {
    /** @scenario "A suggestion left with a comment on a span output becomes that span's correction" */
    it("carries the suggestion into the trace correction for that span before saving", async () => {
      const caller = harness();
      mockWriteTraceSuggestion.mockClear();

      const input = annotationApiCreateInputSchema.parse({
        projectId,
        traceId: spanSuggestionTraceId,
        comment: "this search should have found Amsterdam",
        scoreOptions: {},
        anchorKind: "field",
        anchorId: "span-search",
        anchorPath: "output",
        expectedOutput: "Amsterdam",
      });

      const created = await caller.create(input);

      expect(created.expectedOutput).toBe("Amsterdam");
      expect(mockWriteTraceSuggestion).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          projectId,
          traceId: spanSuggestionTraceId,
          target: { kind: "span", spanId: "span-search", field: "output" },
          text: "Amsterdam",
        }),
      );
    });
  });

  describe("given a comment left on a span (not the trace as a whole)", () => {
    /** @scenario "A trace commented only on one of its spans still counts as annotated" */
    it("still syncs the annotation onto the trace so the has-annotation filter sees it", async () => {
      const caller = harness();
      mockRecordAnnotationOnTrace.mockClear();

      const input = annotationApiCreateInputSchema.parse({
        projectId,
        traceId: spanOnlyTraceId,
        comment: "this tool call misfired",
        scoreOptions: {},
        anchorKind: "span",
        anchorId: "span-tool",
      });

      const created = await caller.create(input);

      expect(mockRecordAnnotationOnTrace).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          tenantId: projectId,
          traceId: spanOnlyTraceId,
          annotationId: created.id,
        }),
      );
    });
  });

  describe("given a page of queue items to enrich", () => {
    /** @scenario "A queue item carries every comment about its trace" */
    it("resolves the assigned queue item's annotations from real storage", async () => {
      const queueTraceId = `test-trace-annotation-queue-enrich-${nanoid()}`;
      await annotationService.create(
        {
          id: nanoid(),
          projectId,
          traceId: queueTraceId,
          comment: "the whole trace is off",
          isThumbsUp: null,
          scoreOptions: {},
          expectedOutput: null,
        },
        { id: "test-user-annotation-suggestion" },
      );
      await annotationService.create(
        {
          id: nanoid(),
          projectId,
          traceId: queueTraceId,
          comment: "about span-1",
          isThumbsUp: null,
          scoreOptions: {},
          expectedOutput: null,
          anchorKind: "span",
          anchorId: "span-1",
        },
        { id: "test-user-annotation-suggestion" },
      );

      const queueItemId = "queue-item-1";
      const fakeQueues = {
        listQueueItemsPage: async () => ({
          totalCount: 1,
          items: [{ id: queueItemId, traceId: queueTraceId, annotationQueueId: null, doneAt: null }],
        }),
        listQueuesWithItems: async () => [],
      };
      const scopedPorts: AnnotationTrpcPorts = {
        ...ports,
        queues: () => fakeQueues,
      } as unknown as AnnotationTrpcPorts;
      const trpc = initTRPC.context<AnnotationTrpcContext>().create();
      const router = AnnotationTrpcApi.create(
        trpc,
        { protected: trpc.procedure, policy: () => (procedure) => procedure },
        scopedPorts,
      );
      const caller = router.createCaller({
        app: { annotations: app },
        actor: () => ({ id: "test-user-annotation-suggestion" }),
      });

      const input = annotationApiOptimizedQueuesInputSchema.parse({
        projectId,
        selectedAnnotations: "pending",
        pageSize: 50,
        pageOffset: 0,
      });
      const result = await caller.getOptimizedAnnotationQueues(input);

      const enriched = result.assignedQueueItems.find((item) => item.id === queueItemId);
      expect(enriched?.annotations.map((row) => row.comment).sort()).toEqual([
        "about span-1",
        "the whole trace is off",
      ]);

      await cleanupTestRows(prisma, [["annotation", { projectId, traceId: queueTraceId }]]);
    });
  });
});
