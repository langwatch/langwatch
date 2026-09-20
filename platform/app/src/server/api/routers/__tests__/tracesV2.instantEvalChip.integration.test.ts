/**
 * @vitest-environment node
 *
 * An `eval:"question"` chip through the real tRPC router on a real
 * ClickHouse: the list keeps the traces a run judged as passed, the facets
 * count the same traces, and a run of another project is not a run of this
 * one.
 *
 * Spec: specs/traces-v2/instant-eval-search.feature ("An eval chip filters
 * by a run's verdicts").
 */
import type { ClickHouseClient } from "@clickhouse/client";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { globalForApp, resetApp } from "~/server/app-layer/app";
import { EvaluationRunService } from "~/server/app-layer/evaluations/evaluation-run.service";
import { NullEvaluationRunRepository } from "~/server/app-layer/evaluations/repositories/evaluation-run.repository";
import {
  InstantEvalRunService,
  setInstantEvalRunService,
} from "~/server/app-layer/instant-evals/run";
import { ClickHouseInstantEvalJudgmentsRepository } from "~/server/app-layer/instant-evals/run/instant-eval-judgments.repository";
import { ClickHouseInstantEvalRunRepository } from "~/server/app-layer/instant-evals/run/instant-eval-run.repository";
import type { InstantEvalJudgmentRecord } from "~/server/app-layer/instant-evals/run/judgments";
import { createTestApp } from "~/server/app-layer/presets";
import { NullTopicRepository } from "~/server/app-layer/topic-clustering/repositories/null-topic.repository";
import { TopicService } from "~/server/app-layer/topic-clustering/topic.service";
import { instantEvalRunKey } from "~/server/app-layer/traces/query-language/instantEvalChips";
import { TraceListClickHouseRepository } from "~/server/app-layer/traces/repositories/trace-list.clickhouse.repository";
import { TraceListService } from "~/server/app-layer/traces/trace-list.service";
import {
  startTestContainers,
  stopTestContainers,
} from "~/server/event-sourcing/__tests__/integration/testContainers";
import { getTestUser } from "../../../../utils/testUtils";
import { appRouter } from "../../root";
import { createInnerTRPCContext } from "../../trpc";

const PROJECT_ID = "test-project-id";
const OTHER_PROJECT_ID = `test-project-other-${nanoid()}`;
const DAY_MS = 24 * 60 * 60 * 1000;
// Inside the table's retention window: a row older than its retention is
// deleted by the TTL, on insert or on the next merge, and the suite reads
// nothing back. Minute-aligned so two suites rarely share a window.
const base =
  Math.floor(Date.now() / 60_000) * 60_000 -
  (20 + Math.floor(Math.random() * 250)) * DAY_MS -
  Math.floor(Math.random() * 24 * 60) * 60_000;
const WINDOW = { from: base - 60_000, to: base + 60_000 };

const run = nanoid();
const PASSED_A = `evalchip-${run}-passed-a`;
const PASSED_B = `evalchip-${run}-passed-b`;
const FAILED = `evalchip-${run}-failed`;
const UNJUDGED = `evalchip-${run}-unjudged`;
const ALL_IDS = [PASSED_A, PASSED_B, FAILED, UNJUDGED];

const QUESTION = "the user is annoyed";
const RUN_ID = `instanteval_${nanoid()}`;
const FOREIGN_RUN_ID = `instanteval_${nanoid()}`;
const key = instantEvalRunKey({
  question: QUESTION,
  target: "traces",
  otherQuery: "",
  window: WINDOW,
});

function traceRow({ traceId, service }: { traceId: string; service: string }) {
  return {
    ProjectionId: `proj-${nanoid()}`,
    TenantId: PROJECT_ID,
    TraceId: traceId,
    Version: "v1",
    Attributes: { "service.name": service },
    OccurredAt: new Date(base),
    CreatedAt: new Date(base),
    UpdatedAt: new Date(base),
    LastEventOccurredAt: new Date(base),
    ComputedIOSchemaVersion: "v1",
    ComputedInput: JSON.stringify({ type: "text", value: "hi" }),
    ComputedOutput: JSON.stringify({ type: "text", value: "done" }),
    TotalDurationMs: 100,
    SpanCount: 1,
    ContainsErrorStatus: false,
    ContainsOKStatus: true,
    Models: ["gpt-5-mini"],
    TraceName: "checkout flow",
  };
}

function judgment({
  tenantId,
  runId,
  traceId,
  passed,
  writtenAt,
}: {
  tenantId: string;
  runId: string;
  traceId: string;
  passed: boolean;
  writtenAt: number;
}): InstantEvalJudgmentRecord {
  return {
    TenantId: tenantId,
    RunId: runId,
    TraceId: traceId,
    QuestionId: "matched",
    ThreadId: "",
    SpanId: "",
    Kind: "boolean",
    Status: "judged",
    Passed: passed ? 1 : 0,
    Score: null,
    Label: "",
    Probability: passed ? 0.9 : 0.1,
    Probabilities: "",
    Error: "",
    OccurredAt: base,
    CreatedAt: writtenAt,
    UpdatedAt: writtenAt,
  };
}

let ch: ClickHouseClient;
let caller: ReturnType<typeof appRouter.createCaller>;

const evalRunsFor = (runId: string) => ({
  [key]: { question: QUESTION, target: "traces" as const, runId },
});

const listFor = (query: string, runId: string) =>
  caller.tracesV2.list({
    projectId: PROJECT_ID,
    timeRange: WINDOW,
    sort: { columnId: "timestamp", direction: "desc" },
    page: 1,
    pageSize: 50,
    query,
    evalRuns: evalRunsFor(runId),
  });

beforeAll(async () => {
  const containers = await startTestContainers();
  ch = containers.clickHouseClient;

  const defaults = createTestApp();
  globalForApp.__langwatch_app = createTestApp({
    traces: {
      ...defaults.traces,
      list: new TraceListService(
        new TraceListClickHouseRepository(async () => ch),
        new EvaluationRunService(new NullEvaluationRunRepository()),
        new TopicService(new NullTopicRepository()),
      ),
    },
  });
  // The chip's resolution reads the run row and nothing else of the service.
  const runs = new ClickHouseInstantEvalRunRepository({
    resolveClient: async () => ch,
  });
  setInstantEvalRunService(
    new InstantEvalRunService({ runs } as unknown as ConstructorParameters<
      typeof InstantEvalRunService
    >[0]),
  );

  const user = await getTestUser();
  caller = appRouter.createCaller(
    createInnerTRPCContext({
      session: { user: { id: user.id }, expires: "1" },
    }),
  );

  await ch.insert({
    table: "trace_summaries",
    values: ALL_IDS.map((traceId) =>
      traceRow({ traceId, service: traceId === FAILED ? "worker" : "api" }),
    ),
    format: "JSONEachRow",
    clickhouse_settings: { async_insert: 0, wait_for_async_insert: 0 },
  });

  // The run was accepted now, and its judgements were written now: a run
  // over an old window writes its verdicts at judging time, not trace time.
  const writtenAt = Date.now();
  const definition = {
    name: null,
    sql: "SELECT TraceId, eval('the user is annoyed') AS matched FROM analytics.traces",
    parameters: {},
    questions: [],
    plan: [],
    rowLimit: 10_000,
  };
  await runs.create({ ...definition, id: RUN_ID, projectId: PROJECT_ID });
  await runs.create({
    ...definition,
    id: FOREIGN_RUN_ID,
    projectId: OTHER_PROJECT_ID,
  });
  const judgments = new ClickHouseInstantEvalJudgmentsRepository(
    async () => ch,
  );
  await judgments.insert([
    judgment({
      tenantId: PROJECT_ID,
      runId: RUN_ID,
      traceId: PASSED_A,
      passed: true,
      writtenAt,
    }),
    judgment({
      tenantId: PROJECT_ID,
      runId: RUN_ID,
      traceId: PASSED_B,
      passed: true,
      writtenAt,
    }),
    judgment({
      tenantId: PROJECT_ID,
      runId: RUN_ID,
      traceId: FAILED,
      passed: false,
      writtenAt,
    }),
  ]);
  await judgments.insert([
    judgment({
      tenantId: OTHER_PROJECT_ID,
      runId: FOREIGN_RUN_ID,
      traceId: PASSED_A,
      passed: true,
      writtenAt,
    }),
  ]);
}, 120_000);

afterAll(async () => {
  if (ch) {
    await ch.exec({
      query:
        "ALTER TABLE trace_summaries DELETE WHERE TenantId = {tenantId:String} AND TraceId IN ({ids:Array(String)})",
      query_params: { tenantId: PROJECT_ID, ids: ALL_IDS },
    });
    for (const [tenantId, runId] of [
      [PROJECT_ID, RUN_ID],
      [OTHER_PROJECT_ID, FOREIGN_RUN_ID],
    ] as const) {
      await ch.exec({
        query:
          "ALTER TABLE instant_eval_judgments DELETE WHERE TenantId = {tenantId:String} AND RunId = {runId:String}",
        query_params: { tenantId, runId },
      });
      await ch.exec({
        query:
          "ALTER TABLE instant_eval_runs DELETE WHERE TenantId = {tenantId:String} AND RunId = {runId:String}",
        query_params: { tenantId, runId },
      });
    }
  }
  setInstantEvalRunService(null);
  await resetApp();
  await stopTestContainers();
});

describe("given a run of the project with judgements on three traces", () => {
  describe("when the list is read with the chip", () => {
    /** @scenario "A run's verdicts filter the table and the sidebar agrees" */
    it("returns the two passed traces, and the facets count the same two", async () => {
      const page = await listFor(`eval:"${QUESTION}"`, RUN_ID);
      expect(page.totalHits).toBe(2);
      expect(page.items.map((item) => item.traceId).sort()).toEqual(
        [PASSED_A, PASSED_B].sort(),
      );

      const { facets } = await caller.tracesV2.facets({
        projectId: PROJECT_ID,
        timeRange: WINDOW,
        query: `eval:"${QUESTION}"`,
        evalRuns: evalRunsFor(RUN_ID),
      });
      const service = facets.find((facet) => facet.key === "service");
      expect(service?.kind).toBe("categorical");
      if (service?.kind !== "categorical") return;
      expect(
        Object.fromEntries(service.topValues.map((v) => [v.value, v.count])),
      ).toEqual({ api: 2 });
    });

    it("keeps the other chips in force beside the eval chip", async () => {
      const page = await listFor(
        `service:worker AND eval:"${QUESTION}"`,
        RUN_ID,
      );
      expect(page.totalHits).toBe(0);
    });
  });
});

describe("given a run id that belongs to another project", () => {
  describe("when the list is read with the chip", () => {
    /** @scenario "A run of another project is not a run of this one" */
    it("returns no traces", async () => {
      const page = await listFor(`eval:"${QUESTION}"`, FOREIGN_RUN_ID);
      expect(page.totalHits).toBe(0);
    });
  });
});
