import { describe, expect, it, vi } from "vitest";
import type { InstantEvalRunView } from "~/server/app-layer/instant-evals/run/processing-block";
import { instantEvalRunSchema, toInstantEvalRunWire } from "../wire";

vi.mock("~/server/analytics/lwql", () => ({ MAX_LWQL_LENGTH: 100_000 }));
vi.mock("~/server/app-layer/instant-evals/run", () => ({
  INSTANT_EVAL_JUDGMENT_STATUSES: ["judged", "skipped", "failed"],
  INSTANT_EVAL_MAX_ROW_CAP: 100_000,
  INSTANT_EVAL_RESULTS_CEILING: 1000,
  INSTANT_EVAL_SAMPLE_CEILING: 100,
}));

const row: InstantEvalRunView = {
  id: "run-local",
  projectId: "project-local",
  name: null,
  sql: "local fixture",
  parameters: {},
  questions: [],
  plan: [],
  rowLimit: 100,
  status: "FINISHED",
  total: 100,
  progress: 20,
  matched: 1,
  matchedByQuestion: {},
  failed: 0,
  skipped: 0,
  tokens: 10,
  costUsd: 0.01,
  priceUsd: 0.02,
  error: null,
  createdAt: new Date(1000),
  updatedAt: new Date(2000),
  startedAt: new Date(1000),
  finishedAt: new Date(2000),
  occurredAt: 2000,
  acceptedAt: 2000,
  lastEventId: "event-local",
  projectionVersion: "2026-09-18",
  processingBlock: {
    code: "instant_eval_processing_disabled",
    observedAtMs: 1500,
    stages: [{ componentType: "command", componentName: "recordPageJudged" }],
  },
};

describe("Instant Eval interruption wire contract", () => {
  /** @scenario Interruption evidence survives flag restoration and terminal reporting */
  it("publishes impairment separately from the execution outcome", () => {
    const wire = instantEvalRunSchema.parse(toInstantEvalRunWire(row));
    expect(wire).toMatchObject({
      status: "finished",
      progress: 20,
      error: null,
      finishedAt: "1970-01-01T00:00:02.000Z",
      processingBlock: row.processingBlock,
    });
    expect(wire).not.toHaveProperty("plan");
  });

  /** @scenario Enabled processing preserves normal events and counters */
  it("keeps the wire shape unchanged when no refusal was observed", () => {
    const { processingBlock: _, ...healthy } = row;
    expect(toInstantEvalRunWire(healthy)).not.toHaveProperty("processingBlock");
  });
});
