/**
 * Sampling a run: the verdicts it already wrote, and the texts they were made
 * about, read again as the caller rather than stored.
 * @see specs/instant-evals/instant-eval-api.feature
 */

import { Temporal } from "@langwatch/time";
import { describe, expect, it } from "vitest";

import { instantEvalJudgment, instantEvalRunRow } from "../../__tests__/instant-eval.fixtures.ts";
import type {
  InstantEvalJudgment,
  InstantEvalJudgmentPage,
  InstantEvalJudgmentSampleQuery,
  InstantEvalJudgmentsRepository,
} from "../../repositories/instant-eval-judgments.repository.ts";
import type { InstantEvalTextSource } from "../instant-eval-estimate.service.ts";
import { InstantEvalSampleService } from "../instant-eval-sample.service.ts";

const NOW = Temporal.Instant.from("2026-09-18T12:00:00Z");
const STARTED = Temporal.Instant.from("2026-09-18T10:00:00Z");
const CALLER = { id: "project-1", lwqlKey: "key-1" } as const;

const QUESTION = {
  id: "annoyed",
  function: "eval_boolean",
  kind: "boolean",
  reads: "probability",
  question: { id: "annoyed", kind: "boolean" },
};

/** The judgement store, answering one fixed sample and recording the ask. */
class RecordingJudgments implements InstantEvalJudgmentsRepository {
  readonly asked: InstantEvalJudgmentSampleQuery[] = [];

  constructor(private readonly judged: readonly InstantEvalJudgment[]) {}

  async insert(): Promise<void> {
    // A sample writes no judgement.
  }

  async getPage(): Promise<InstantEvalJudgmentPage> {
    return { judgments: [] };
  }

  async findSample(query: InstantEvalJudgmentSampleQuery): Promise<readonly InstantEvalJudgment[]> {
    this.asked.push(query);
    return this.judged;
  }
}

/** The extraction half, recording the traces it was asked to hydrate. */
class RecordingTexts implements InstantEvalTextSource {
  readonly asked: { traceIds: readonly string[]; lwqlKey: string; sql: string }[] = [];

  async texts(input: {
    project: { id: string; lwqlKey: string };
    sql: string;
    traceIds: readonly string[];
  }): Promise<readonly Record<string, unknown>[]> {
    this.asked.push({
      traceIds: input.traceIds,
      lwqlKey: input.project.lwqlKey,
      sql: input.sql,
    });
    return input.traceIds.map((traceId) => ({ TraceId: traceId }));
  }
}

function harness(judged: readonly InstantEvalJudgment[]) {
  const judgments = new RecordingJudgments(judged);
  const textSource = new RecordingTexts();
  const service = InstantEvalSampleService.create({
    judgments,
    textSource,
    now: () => NOW,
    seed: () => 7,
  });

  return { service, judgments, textSource };
}

const ROW = instantEvalRunRow({
  questions: [QUESTION],
  startedAt: STARTED,
  finishedAt: null,
});

async function sample(rows: number, judged: readonly InstantEvalJudgment[]) {
  const { service, judgments, textSource } = harness(judged);
  const result = await service.getSample({
    caller: CALLER,
    protections: { canSeeCosts: true },
    projectId: "project-1",
    runId: "instanteval_1",
    row: ROW,
    rows,
  });

  return { result, judgments, textSource };
}

describe("sampling a run", () => {
  it("bounds the read by the run's own clock, and asks for matches first", async () => {
    const { judgments } = await sample(5, [instantEvalJudgment()]);

    expect(judgments.asked).toEqual([
      {
        projectId: "project-1",
        runId: "instanteval_1",
        writtenFrom: STARTED,
        writtenUntil: NOW,
        traces: 5,
        shouldPreferMatched: true,
        seed: 7,
      },
    ]);
  });

  it("never reads more traces than the ceiling, nor fewer than one", async () => {
    const above = await sample(500, [instantEvalJudgment()]);
    const below = await sample(0, [instantEvalJudgment()]);

    expect(above.judgments.asked[0]?.traces).toBe(25);
    expect(below.judgments.asked[0]?.traces).toBe(1);
  });

  it("re-reads the texts of the sampled traces as the caller's own identity", async () => {
    const { result, textSource } = await sample(5, [
      instantEvalJudgment({ traceId: "trace-1" }),
      instantEvalJudgment({ traceId: "trace-1", questionId: "other" }),
      instantEvalJudgment({ traceId: "trace-2" }),
    ]);

    expect(textSource.asked).toEqual([
      {
        traceIds: ["trace-1", "trace-2"],
        lwqlKey: "key-1",
        sql: ROW.sql,
      },
    ]);
    expect(result.rows).toEqual([{ TraceId: "trace-1" }, { TraceId: "trace-2" }]);
    expect(result.judgments).toHaveLength(3);
  });

  it("reads no text at all when the run judged nothing", async () => {
    const { result, textSource } = await sample(5, []);

    expect(textSource.asked).toEqual([]);
    expect(result).toEqual({ rows: [], judgments: [] });
  });

  it("reads to now for a run that has not finished, and to its end once it has", async () => {
    const finished = Temporal.Instant.from("2026-09-18T11:00:00Z");
    const { service, judgments } = harness([instantEvalJudgment()]);

    await service.getSample({
      caller: CALLER,
      protections: {},
      projectId: "project-1",
      runId: "instanteval_1",
      row: instantEvalRunRow({ questions: [QUESTION], startedAt: STARTED, finishedAt: finished }),
      rows: 3,
    });

    expect(judgments.asked[0]?.writtenUntil).toBe(finished);
  });
});
