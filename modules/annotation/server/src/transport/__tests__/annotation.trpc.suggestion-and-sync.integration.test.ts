/**
 * @vitest-environment node
 * The annotation tRPC family over real annotation storage: what a suggestion
 * carries onto the trace, what a span-only comment still marks, and what a
 * queue page resolves.
 */
import {
  annotationApiCreateInputSchema,
  annotationApiOptimizedQueuesInputSchema,
  type AnnotationApi,
} from "@langwatch/annotation-contract";
import { createTrpcRuntime, type TrpcRuntimePorts } from "@langwatch/api/trpc";
import {
  PrismaConfigService,
  PrismaConnectionService,
  PrismaQueryGuard,
  type PrismaQueryContext,
  type PrismaQueryExecutor,
} from "@langwatch/prisma-client";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { cleanupTestRows } from "@langwatch/test-harness";
import { initTRPC } from "@trpc/server";
import { nanoid } from "nanoid";
import { afterAll, describe, expect, it, vi } from "vitest";

import {
  createAnnotationTestAuthz,
  createAnnotationTestApp,
  createAnnotationTestOrganizations,
  createAnnotationTestProjects,
  createAnnotationTestTraces,
  createAnnotationTestUsers,
} from "../../app/__tests__/annotation.fixture.ts";
import { MemoryAnnotationRepositories } from "../../repositories/memory/memory.annotation.repositories.ts";
import { PrismaAnnotationRepository } from "../../repositories/prisma/prisma.annotation.repository.ts";
import { annotationTrpcTransport } from "../annotation.trpc.ts";

class AllowTestQueries extends PrismaQueryGuard {
  execute(context: PrismaQueryContext, next: PrismaQueryExecutor): Promise<unknown> {
    return next(context.args);
  }
}

type TestContext = { actor: { id: string } };

const databaseUrl = process.env.LANGWATCH_TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const connection = databaseUrl
  ? PrismaConnectionService.create({ guard: new AllowTestQueries() }).connect(
      PrismaConfigService.create().resolve({ databaseUrl, log: ["error"] }),
    )
  : null;
const prisma = connection?.client as PrismaClient;

const projectId = "test-project-id";
const CALLER_USER_ID = "test-user-annotation-suggestion";

/**
 * The declared family on the runtime a process mounts it on: the caller the
 * process resolves, and an authorization that admits, so what the tests
 * observe is the transport and the application rather than a permission gate.
 */
function callerFor(app: AnnotationApi) {
  const trpc = initTRPC.context<TestContext>().create();

  const ports: TrpcRuntimePorts<TestContext> = {
    identity: { caller: (ctx) => ({ actor: { type: "user", id: ctx.actor.id } }) },
    authorization: {
      forRequest: () => ({
        getDecision: async () => ({ permitted: true, organizationRole: null }),
        getProjectAnyDecision: async () => ({ permitted: true, organizationRole: null }),
        checkScopeLineage: async () => ({ kind: "consistent" }),
      }),
    },
    denials: {
      membershipDisabled: () => new Error("membership disabled"),
      liteMemberRestricted: () => new Error("lite member"),
    },
    audit: { record: async () => {}, redact: ({ args }) => args, exempt: () => false },
    errors: {
      report: () => {},
      asError: (failure) => (failure instanceof Error ? failure : new Error(String(failure))),
      translate: () => undefined,
    },
  };

  return createTrpcRuntime<TestContext>({ root: trpc, procedure: trpc.procedure, ports })
    .mount(annotationTrpcTransport, () => app)
    .createCaller({ actor: { id: CALLER_USER_ID } });
}

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
        organizations: createAnnotationTestOrganizations([CALLER_USER_ID]),
        traces,
        users: createAnnotationTestUsers(),
        permissions,
      },
    });
  }

  const app = appFor();

  function harness() {
    return callerFor(app);
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
        userId: CALLER_USER_ID,
        comment: "the whole trace is off",
        isThumbsUp: null,
        scoreOptions: {},
        expectedOutput: null,
      });

      await app.create({
        id: nanoid(),
        projectId,
        traceId: queueTraceId,
        userId: CALLER_USER_ID,
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
        annotators: [`user-${CALLER_USER_ID}`],
        userId: CALLER_USER_ID,
      });

      const caller = callerFor(scopedApp);

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
