/**
 * Evaluation reads the runs on a batch of traces from its own table, through its trace id index.
 * Spec: modules/evaluation/specs/evaluation-trace-evaluations.feature
 */
import { AuthorizedClickHouse, type QueryRequest } from "@langwatch/clickhouse-client";
import {
  idIndexedClientDouble,
  readyIdIndexedClientDouble,
} from "@langwatch/clickhouse-client/testing";
import { describe, expect, it } from "vitest";

import { ownProof } from "../../../__tests__/support/authorization-proofs.fixture.ts";
import {
  EVALUATION_ID_INDEXES,
  EVALUATION_SECOND_ID_INDEXES,
} from "../clickhouse.evaluation-id-indexes.database.ts";
import { EvaluationRunClickHouseReadRepository } from "../evaluation-run-read.repository.ts";

const DAY_MS = 86_400_000;
const FROM_MS = Date.parse("2026-10-03T10:00:00Z");
const TO_MS = Date.parse("2026-10-05T10:00:00Z");
const INDEXES = [...EVALUATION_ID_INDEXES, ...EVALUATION_SECOND_ID_INDEXES];

const row = {
  EvaluationId: "evaluation_1",
  EvaluatorId: "evaluator_1",
  EvaluatorType: "native",
  EvaluatorName: "Quality",
  TraceId: "trace_1",
  IsGuardrail: 1,
  Status: "processed",
  Score: 0.5,
  Passed: 0,
  Label: "mid",
  Details: "details",
  Error: null,
  Inputs: '{"query":"hello"}',
  ScheduledAt: "1700000000000",
  StartedAt: "1700000000100",
  CompletedAt: null,
};

async function readerOver({
  answers,
  ready = true,
}: {
  answers: (request: QueryRequest) => readonly Record<string, unknown>[] | Error;
  ready?: boolean;
}) {
  const statements: QueryRequest[] = [];
  const driver = {
    async execute(request: QueryRequest) {
      if (request.sql.includes("count() AS n")) {
        return { rows: [{ n: 1, fromMs: FROM_MS, toMs: TO_MS }] };
      }
      statements.push(request);
      const answer = answers(request);
      if (answer instanceof Error) throw answer;
      return { rows: answer };
    },
  };
  const client = ready
    ? await readyIdIndexedClientDouble({ indexes: INDEXES, driver })
    : idIndexedClientDouble({ indexes: INDEXES, driver });
  return {
    statements,
    repository: EvaluationRunClickHouseReadRepository.create({
      clickhouse: new AuthorizedClickHouse({ resolveClient: async () => client }),
    }),
  };
}

const authorization = ownProof({ projectId: "project_1" });

describe("the runs on a batch of traces", () => {
  /** @scenario "A batch of traces' earlier evaluations is read through the trace id index" */
  it("bounds the outer read and the latest-version subquery by the trace index, a day each side", async () => {
    const { repository, statements } = await readerOver({ answers: () => [row] });

    const found = await repository.findTraceEvaluations({
      authorization,
      traceIds: ["trace_1", "trace_2"],
    });

    expect(statements).toHaveLength(1);
    expect(statements[0]?.sql.match(/idBound_fromMs/g)).toHaveLength(2);
    expect(statements[0]?.params).toMatchObject({
      traceIds: ["trace_1", "trace_2"],
      idBound_fromMs: FROM_MS - DAY_MS,
      idBound_toMs: TO_MS + DAY_MS,
    });
    expect(found).toEqual([
      {
        evaluationId: "evaluation_1",
        evaluatorId: "evaluator_1",
        evaluatorType: "native",
        evaluatorName: "Quality",
        traceId: "trace_1",
        isGuardrail: true,
        status: "processed",
        score: 0.5,
        passed: false,
        label: "mid",
        details: "details",
        error: null,
        inputs: { query: "hello" },
        timestamps: { scheduledAt: 1700000000000, startedAt: 1700000000100, completedAt: null },
      },
    ]);
  });

  /** @scenario "A batch of traces' earlier evaluations is read through the trace id index" */
  it("reads with no time bound while the trace index is not ready", async () => {
    const { repository, statements } = await readerOver({ answers: () => [row], ready: false });

    await repository.findTraceEvaluations({ authorization, traceIds: ["trace_1"] });

    expect(statements).toHaveLength(1);
    expect(statements[0]?.sql).not.toContain("idBound");
    expect(statements[0]?.params).not.toHaveProperty("idBound_fromMs");
  });

  /** @scenario "A trace's earlier evaluations are still read when the inputs exceed the memory limit" */
  it("retries without the inputs when the read hits the memory limit", async () => {
    const { repository, statements } = await readerOver({
      answers: (request) =>
        request.sql.includes(", Inputs")
          ? new Error("Memory limit (for query) exceeded")
          : [{ ...row, Inputs: undefined }],
    });

    const found = await repository.findTraceEvaluations({ authorization, traceIds: ["trace_1"] });

    expect(statements).toHaveLength(2);
    expect(found[0]).not.toHaveProperty("inputs");
  });

  it("reads nothing for no traces", async () => {
    const { repository, statements } = await readerOver({ answers: () => [row] });

    await expect(repository.findTraceEvaluations({ authorization, traceIds: [] })).resolves.toEqual(
      [],
    );
    expect(statements).toHaveLength(0);
  });
});
