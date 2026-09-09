import {
  createAnnotationTestAuthz,
  createAnnotationTestApp,
  createAnnotationTestOrganizations,
  createAnnotationTestProjects,
  createAnnotationTestTraces,
  createAnnotationTestUsers,
} from "../../app/__tests__/annotation.fixture.ts";
/**
 * @vitest-environment node
 */
import { initTRPC } from "@trpc/server";
import { createTrpcService } from "@langwatch/api/trpc";
import { createTrpcHandlerBinding } from "@langwatch/api/composition";
import { nanoid } from "nanoid";
import { afterAll, describe, expect, it, vi } from "vitest";
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
  type AnnotationApi,
} from "@langwatch/annotation-contract";
import { MemoryAnnotationRepositories } from "../../repositories/memory/memory.annotation.repositories.ts";
import { PrismaAnnotationRepository } from "../../repositories/prisma/prisma.annotation.repository.ts";
import { annotationTrpcTransport } from "../annotation.trpc.ts";

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
  const mockWriteTraceSuggestion = vi.fn(async () => undefined);
  const mockRecordAnnotationOnTrace = vi.fn(async () => undefined);
  const mockRemoveAnnotationFromTrace = vi.fn(async () => undefined);
  const mockLoadTraces = vi.fn(async () => []);
  const mockProbeProjectPermission = vi.fn(async () => true);

  const traces = createAnnotationTestTraces();
  traces.findExistingTraceIds = async () => [];
  traces.writeSuggestion = mockWriteTraceSuggestion;
  traces.loadTraces = mockLoadTraces;
  traces.recordAnnotation = mockRecordAnnotationOnTrace;
  traces.removeAnnotation = mockRemoveAnnotationFromTrace;
  const permissions = createAnnotationTestAuthz();
  permissions.hasProjectPermission = async () => mockProbeProjectPermission();

  function appFor(): AnnotationApi {
    const repositories = MemoryAnnotationRepositories.create();

    return createAnnotationTestApp({
      repositories: {
        annotations: PrismaAnnotationRepository.create({ prisma }),
        scores: repositories.scores,
        queues: repositories.queues,
        queueItems: repositories.queueItems,
      },
      dependencies: {
        projects: createAnnotationTestProjects(),
        organizations: createAnnotationTestOrganizations(["test-user-annotation-suggestion"]),
        traces,
        users: createAnnotationTestUsers(),
        permissions,
      },
    });
  }

  const app = appFor();

  function harness() {
    const trpc = initTRPC.context<{ actor: { id: string } }>().create();

    const service = createTrpcService({
      root: trpc,
      procedures: { protected: trpc.procedure, policy: () => (procedure) => procedure },
      handlerBinding: createTrpcHandlerBinding<{ actor: { id: string } }, AnnotationApi>(
        async ({ ctx }) => ({
          app,
          actor: { type: "user", id: ctx.actor.id },
          scope: null,
        }),
      ),
    });

    return annotationTrpcTransport.router(service).createCaller({
      actor: { id: "test-user-annotation-suggestion" },
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
    /** @scenario "A span output suggestion becomes that span's correction" */
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

      await app.create({
        id: nanoid(),
        projectId,
        traceId: queueTraceId,
        userId: "test-user-annotation-suggestion",
        comment: "the whole trace is off",
        isThumbsUp: null,
        scoreOptions: {},
        expectedOutput: null,
      });

      await app.create({
        id: nanoid(),
        projectId,
        traceId: queueTraceId,
        userId: "test-user-annotation-suggestion",
        comment: "about span-1",
        isThumbsUp: null,
        scoreOptions: {},
        expectedOutput: null,
        anchorKind: "span",
        anchorId: "span-1",
      });

      const scopedApp = appFor();
      traces.findExistingTraceIds = async () => [queueTraceId];

      await scopedApp.queueTraces({
        projectId,
        traceIds: [queueTraceId],
        annotators: ["user-test-user-annotation-suggestion"],
        userId: "test-user-annotation-suggestion",
      });

      const trpc = initTRPC.context<{ actor: { id: string } }>().create();

      const service = createTrpcService({
        root: trpc,
        procedures: { protected: trpc.procedure, policy: () => (procedure) => procedure },
        handlerBinding: createTrpcHandlerBinding<{ actor: { id: string } }, AnnotationApi>(
          async ({ ctx }) => ({
            app: scopedApp,
            actor: { type: "user", id: ctx.actor.id },
            scope: null,
          }),
        ),
      });

      const caller = annotationTrpcTransport.router(service).createCaller({
        actor: { id: "test-user-annotation-suggestion" },
      });

      const input = annotationApiOptimizedQueuesInputSchema.parse({
        projectId,
        selectedAnnotations: "pending",
        pageSize: 50,
        pageOffset: 0,
      });

      const result = await caller.getOptimizedAnnotationQueues(input);

      const enriched = result.assignedQueueItems.find((item) => item.traceId === queueTraceId);

      expect(enriched?.annotations.map((row) => row.comment).sort()).toEqual([
        "about span-1",
        "the whole trace is off",
      ]);

      await cleanupTestRows(prisma, [["annotation", { projectId, traceId: queueTraceId }]]);
    });
  });
});
