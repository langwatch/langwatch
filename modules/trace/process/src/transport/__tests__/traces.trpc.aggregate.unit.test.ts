/**
 * @vitest-environment node
 * ADR-177 block F at the door: the trace drawer's reads narrow an aggregate's proof to one member.
 * Ports main's tracesV2.aggregate cases; the ClickHouse fence is in the *.proof.integration suites.
 * Spec: specs/governance/aggregate-project.feature
 */
import { createTrpcRuntime } from "@langwatch/api/trpc";
import { type Authorization, projectIdsReadBy } from "@langwatch/authorization";
import { PLATFORM_DEFAULT_DATA_PRIVACY } from "@langwatch/data-privacy-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { trpcTestMembers } from "@langwatch/test-harness/trpc-members";
import type { SpanSummaryRow } from "@langwatch/trace-contract";
import { initTRPC } from "@trpc/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { aggregateProof, ownProof } from "../../__tests__/support/authorization-proofs.fixture.ts";
import { createTraceAppHarness } from "../../app/__tests__/support/trace-app.harness.ts";
import type { TraceAppDependencies } from "../../app/trace.app.ts";
import { createInitState } from "../../eventing/__tests__/trace-summary-test.fixtures.ts";
import { TraceSummaryService } from "../../features/read/services/trace-summary-read.service.ts";
import { MemoryTraceEvaluationRunsRepository } from "../../repositories/memory/memory.trace-evaluation-runs.repository.ts";
import { MemoryTraceSummaryRepository } from "../../repositories/memory/memory.trace-summary.repository.ts";
import { traceReadMapperPorts } from "../../rules/trace-read-mapper-ports.rules.ts";
import { tracesTrpcTransport } from "../traces.trpc.ts";

type TestContext = { actor: { id: string } };

const AGGREGATE = "project-aggregate";
const ENGINEER = "project-engineer";
const SELLER = "project-seller";
const OUTSIDER = "project-outsider";
/** Hides captured content; drops input and output at ingest. */
const STRICT = "project-strict";
const DROPPER = "project-dropper";
const TRACE = "trace-engineer";
const SELLER_TRACE = "trace-seller";
const TWIN_TRACE = "trace-twin";
const STRICT_TRACE = "trace-strict";
const DROPPED_TRACE = "trace-dropped";
const VISIBLE = { canSeeCapturedInput: true, canSeeCapturedOutput: true, canSeeCosts: true };
const HIDDEN = { canSeeCapturedInput: false, canSeeCapturedOutput: false, canSeeCosts: true };

const proof = (): Authorization =>
  aggregateProof({
    projectId: AGGREGATE,
    members: [
      { projectId: ENGINEER, from: 0 },
      { projectId: SELLER, from: 0 },
      { projectId: STRICT, from: 0 },
      { projectId: DROPPER, from: 0 },
    ],
  });

function spanOf(tenantId: string): SpanSummaryRow {
  return {
    spanId: `span-${tenantId}`,
    parentSpanId: null,
    spanName: `span of ${tenantId}`,
    durationMs: 50,
    statusCode: 1,
    spanType: null,
    toolName: null,
    requestId: null,
    querySource: null,
    toolUseId: null,
    model: null,
    cost: null,
    inputTokens: null,
    cacheReadTokens: null,
    cacheCreationTokens: null,
    outputTokens: null,
    startTimeMs: 1_000,
    updatedAtMs: 1_000,
  };
}

function runOf(tenantId: string, traceId: string) {
  return {
    tenantId,
    evaluationId: `evaluation-${tenantId}-${traceId}`,
    evaluatorId: `monitor-of-${tenantId}`,
    evaluatorType: "langevals/exact_match",
    evaluatorName: null,
    traceId,
    isGuardrail: false,
    status: "processed" as const,
    score: 1,
    passed: true,
    label: null,
    details: `verdict prose of ${tenantId}`,
    inputs: { input: `question of ${tenantId}` },
    error: null,
    errorDetails: null,
    createdAt: 1_000,
    updatedAt: 1_000,
    LastEventOccurredAt: 1_000,
    archivedAt: null,
    scheduledAt: null,
    startedAt: null,
    completedAt: null,
    costId: null,
  };
}

/** A read that names the strict member is shown under its policy; the fold is data-privacy's. */
function protectionsFor(projectIds: readonly string[]) {
  if (projectIds.includes(STRICT)) return HIDDEN;
  return VISIBLE;
}

/** Engineer and seller each hold their trace and TWIN_TRACE; the outsider holds TRACE too. */
async function harness({ authorization = proof() }: { authorization?: Authorization } = {}) {
  const holdings: [string, string][] = [
    [ENGINEER, TRACE],
    [SELLER, SELLER_TRACE],
    [ENGINEER, TWIN_TRACE],
    [SELLER, TWIN_TRACE],
    [OUTSIDER, TRACE],
    [STRICT, STRICT_TRACE],
    [ENGINEER, STRICT_TRACE],
    [DROPPER, DROPPED_TRACE],
  ];
  const repository = MemoryTraceSummaryRepository.create();
  for (const [tenantId, traceId] of holdings) {
    await repository.upsert(
      {
        ...createInitState(),
        traceId,
        computedInput: tenantId === DROPPER ? null : `input of ${tenantId}`,
        computedOutput: tenantId === DROPPER ? null : `output of ${tenantId}`,
      },
      tenantId,
    );
  }
  const spans: TraceAppDependencies["traces"]["spans"] = createApiFixture<
    TraceAppDependencies["traces"]["spans"]
  >({
    getSpanSummaryByTraceId: async ({ authorization, traceId }) =>
      projectIdsReadBy(authorization)
        .filter((tenantId) => holdings.some(([t, id]) => t === tenantId && id === traceId))
        .map(spanOf),
  });
  const app = createTraceAppHarness({
    traces: { summary: TraceSummaryService.create({ repository }), spans },
    evaluationRuns: MemoryTraceEvaluationRunsRepository.create({
      runs: holdings.map(([tenantId, traceId]) => runOf(tenantId, traceId)),
    }),
    protections: createApiFixture<NonNullable<TraceAppDependencies["protections"]>>({
      resolve: async ({ projectId, authorization: read }) =>
        protectionsFor(read ? projectIdsReadBy(read) : [projectId]),
    }),
  });

  const trpc = initTRPC.context<TestContext>().create();
  const base = trpcTestMembers<TestContext>();
  const members = trpcTestMembers<TestContext>({
    overrides: {
      authorization: {
        forRequest: (request) => ({
          ...base.authorization.forRequest(request),
          authorization: async () => authorization,
        }),
      },
    },
  });
  const router = createTrpcRuntime<TestContext>({
    root: trpc,
    procedure: trpc.procedure,
    members,
  }).mount(tracesTrpcTransport, () => app);

  return router.createCaller({ actor: { id: "ana" } });
}

const refusalOf = (read: Promise<unknown>) =>
  read.then(
    () => null,
    (error: unknown) => error,
  );

describe("Feature: trace routes carry the proof", () => {
  describe("given an aggregate project with a member holding one trace", () => {
    describe("when ana opens that trace from the aggregate's list", () => {
      /** @scenario "A member trace opens in detail under the aggregate" */
      it("shows the member's spans and names the member as the owner", async () => {
        const caller = await harness();
        const args = { projectId: AGGREGATE, traceId: TRACE, tenantId: ENGINEER };

        const header = await caller.header({ ...args, full: false });
        const spans = await caller.spanTree(args);

        expect(header.projectId).toBe(ENGINEER);
        expect(spans.map((span) => span.name)).toEqual([`span of ${ENGINEER}`]);
      });

      it("refuses a member the proof does not read, whatever project is shown", async () => {
        const caller = await harness();

        const refusal = await refusalOf(
          caller.spanTree({ projectId: AGGREGATE, traceId: TRACE, tenantId: OUTSIDER }),
        );

        expect(refusal).toMatchObject({ cause: { code: "trace_not_found" } });
      });

      it("finds the member from the proof when no member is named", async () => {
        const caller = await harness();
        const args = { projectId: AGGREGATE, traceId: SELLER_TRACE };

        const header = await caller.header({ ...args, full: false });
        const spans = await caller.spanTree(args);

        expect(header.projectId).toBe(SELLER);
        expect(spans.map((span) => span.name)).toEqual([`span of ${SELLER}`]);
      });
    });
  });

  describe("given a member trace that an online evaluation already scored", () => {
    describe("when ana opens that trace from the aggregate", () => {
      it("shows the owner's evaluation and none of the outsider's", async () => {
        const caller = await harness();

        const evaluations = await caller.evals({
          projectId: AGGREGATE,
          traceId: TRACE,
          tenantId: ENGINEER,
        });

        expect(evaluations.map((run) => run.evaluatorId)).toEqual([`monitor-of-${ENGINEER}`]);
      });
    });

    describe("when ana opens the drawer's evaluations panel from the aggregate", () => {
      /** @scenario "The owner's existing evaluation results show on a member trace" */
      it("shows the owner's evaluation through the route the panel calls", async () => {
        const caller = await harness();

        const evaluations = await caller.getEvaluations({
          projectId: AGGREGATE,
          traceId: TRACE,
          tenantId: ENGINEER,
        });

        expect(evaluations?.map((run) => run.evaluator_id)).toEqual([`monitor-of-${ENGINEER}`]);
      });

      it("finds the member from the proof when no member is named", async () => {
        const caller = await harness();

        const evaluations = await caller.getEvaluations({ projectId: AGGREGATE, traceId: TRACE });

        expect(evaluations?.map((run) => run.evaluator_id)).toEqual([`monitor-of-${ENGINEER}`]);
      });

      it("refuses a member the proof does not read", async () => {
        const caller = await harness();

        const refusal = await refusalOf(
          caller.getEvaluations({ projectId: AGGREGATE, traceId: TRACE, tenantId: OUTSIDER }),
        );

        expect(refusal).toMatchObject({ cause: { code: "trace_not_found" } });
      });
    });
  });

  describe("given an aggregate whose two members each hold a trace with the same id", () => {
    describe("when ana opens it from the second member's row", () => {
      /** @scenario "A trace id held by two members opens the member it was listed under" */
      it("reads the header, the spans and the evaluations from that member alone", async () => {
        const caller = await harness();
        const args = { projectId: AGGREGATE, traceId: TWIN_TRACE, tenantId: SELLER };

        const header = await caller.header({ ...args, full: false });
        const spans = await caller.spanTree(args);
        const evaluations = await caller.evals(args);

        expect(header.projectId).toBe(SELLER);
        expect(header.input).toBe(`input of ${SELLER}`);
        expect(spans.map((span) => span.name)).toEqual([`span of ${SELLER}`]);
        expect(evaluations.map((run) => run.evaluatorId)).toEqual([`monitor-of-${SELLER}`]);
      });
    });

    describe("when ana opens it with no member named", () => {
      it("picks the same member on every read behind the drawer", async () => {
        const caller = await harness();
        const args = { projectId: AGGREGATE, traceId: TWIN_TRACE };

        const header = await caller.header({ ...args, full: false });
        const spans = await caller.spanTree(args);
        const evaluations = await caller.evals(args);
        const again = await caller.header({ ...args, full: false });

        const picked = header.projectId;
        expect([ENGINEER, SELLER]).toContain(picked);
        expect(again.projectId).toBe(picked);
        expect(spans.map((span) => span.name)).toEqual([`span of ${picked}`]);
        expect(evaluations.map((run) => run.evaluatorId)).toEqual([`monitor-of-${picked}`]);
      });
    });
  });
});

describe("Feature: an aggregate read applies the strictest member policy", () => {
  afterEach(() => vi.restoreAllMocks());

  describe("given an evaluation on each member that recorded its inputs and prose", () => {
    const evaluationsVia = async (args: {
      projectId: string;
      traceId: string;
      tenantId?: string;
    }) => {
      const caller = await harness({
        authorization:
          args.projectId === AGGREGATE ? proof() : ownProof({ projectId: args.projectId }),
      });
      const [run] = await caller.evals(args);
      const [legacy] = (await caller.getEvaluations(args)) ?? [];
      return { run, legacy };
    };

    describe("when ana opens the strict member's trace from the aggregate", () => {
      /** @scenario "The strictest member privacy policy applies" */
      it("hides the evaluation's inputs and prose and keeps its verdict", async () => {
        const { run, legacy } = await evaluationsVia({
          projectId: AGGREGATE,
          traceId: STRICT_TRACE,
          tenantId: STRICT,
        });

        expect(run).toMatchObject({
          evaluatorId: `monitor-of-${STRICT}`,
          passed: true,
          details: null,
          inputs: null,
        });
        expect(legacy).toMatchObject({ passed: true, details: null });
        expect(legacy?.inputs ?? null).toBeNull();
      });
    });

    describe("when ana opens the loose member's trace from the aggregate", () => {
      it("shows the evaluation's inputs and prose, as its spans are shown", async () => {
        const { run, legacy } = await evaluationsVia({
          projectId: AGGREGATE,
          traceId: STRICT_TRACE,
          tenantId: ENGINEER,
        });

        expect(run?.details).toBe(`verdict prose of ${ENGINEER}`);
        expect(legacy?.details).toBe(run?.details);
        expect(run?.inputs).toEqual({ input: `question of ${ENGINEER}` });
      });
    });

    describe("when ana opens the strict member directly", () => {
      it("hides the evaluation's content there too, as a plain project", async () => {
        const { run } = await evaluationsVia({ projectId: STRICT, traceId: STRICT_TRACE });

        expect(run).toMatchObject({ passed: true, details: null, inputs: null });
      });
    });
  });

  describe("given an aggregate with a member that drops input and output", () => {
    describe("when ana opens that member's trace from the aggregate", () => {
      /** @scenario "A member trace whose content was dropped says so under the aggregate" */
      it("says the input and output were dropped, as on the member", async () => {
        const dropping = {
          ...PLATFORM_DEFAULT_DATA_PRIVACY,
          categories: {
            ...PLATFORM_DEFAULT_DATA_PRIVACY.categories,
            input: {
              ...PLATFORM_DEFAULT_DATA_PRIVACY.categories.input,
              disposition: "drop" as const,
            },
            output: {
              ...PLATFORM_DEFAULT_DATA_PRIVACY.categories.output,
              disposition: "drop" as const,
            },
          },
        };
        vi.spyOn(
          traceReadMapperPorts.contentPrivacy,
          "getResolvedPolicyForProject",
        ).mockImplementation(async ({ projectId }) =>
          projectId === DROPPER ? dropping : PLATFORM_DEFAULT_DATA_PRIVACY,
        );

        const viaAggregate = await (
          await harness()
        ).header({
          projectId: AGGREGATE,
          traceId: DROPPED_TRACE,
          tenantId: DROPPER,
          full: false,
        });
        const viaMember = await (
          await harness({ authorization: ownProof({ projectId: DROPPER }) })
        ).header({
          projectId: DROPPER,
          traceId: DROPPED_TRACE,
          full: false,
        });

        expect(viaAggregate.privacy).toEqual({ droppedCategories: ["input", "output"] });
        expect(viaAggregate.privacy).toEqual(viaMember.privacy);
      });
    });
  });
});
