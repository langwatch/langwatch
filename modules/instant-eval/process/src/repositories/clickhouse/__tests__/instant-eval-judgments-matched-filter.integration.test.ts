/** @vitest-environment node */

/**
 * Matched-filter behaviour on real ClickHouse `instant_eval_judgments` rows.
 * @see modules/instant-eval/specs/instant-eval-api.feature
 */
import { randomUUID } from "node:crypto";

import type { ClickHouseClient } from "@clickhouse/client";
import { Temporal } from "@langwatch/time";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { InstantEvalJudgmentRecord } from "../../instant-eval-judgments.repository.ts";
import { ClickHouseInstantEvalJudgmentsRepository } from "../clickhouse.instant-eval-judgments.repository.ts";
import {
  createTestClickHouseClient,
  testClickHouseUrl,
} from "./support/clickhouse-endpoint.support.ts";

const clickHouseUrl = testClickHouseUrl();
const tenantId = `${randomUUID()}-matched-filter`;
const runId = `${randomUUID()}-run`;
const now = Temporal.Now.instant().epochMilliseconds;
const writtenFrom = Temporal.Instant.fromEpochMilliseconds(now - 60_000);
const writtenUntil = Temporal.Instant.fromEpochMilliseconds(now + 60_000);

let ch: ClickHouseClient;
let judgments: ClickHouseInstantEvalJudgmentsRepository;

function judgmentRecord(
  overrides: Partial<InstantEvalJudgmentRecord> & Pick<InstantEvalJudgmentRecord, "TraceId">,
): InstantEvalJudgmentRecord {
  return {
    TenantId: tenantId,
    RunId: runId,
    QuestionId: "q-bool",
    ThreadId: "",
    SpanId: "",
    Kind: "boolean",
    Status: "judged",
    Passed: null,
    Score: null,
    Label: "",
    Probability: null,
    Probabilities: "",
    Error: "",
    OccurredAt: now,
    CreatedAt: now,
    UpdatedAt: now,
    ...overrides,
  };
}

describe.skipIf(!clickHouseUrl)(
  "ClickHouseInstantEvalJudgmentsRepository.getPage() matched filter (real ClickHouse)",
  () => {
    beforeAll(async () => {
      if (!clickHouseUrl) return;
      ch = createTestClickHouseClient(clickHouseUrl);
      judgments = ClickHouseInstantEvalJudgmentsRepository.create({
        resolveClient: async () => ch,
      });

      await judgments.insert([
        judgmentRecord({
          TraceId: "trace-bool-pass",
          QuestionId: "q-bool",
          Kind: "boolean",
          Status: "judged",
          Passed: 1,
        }),
        judgmentRecord({
          TraceId: "trace-bool-fail",
          QuestionId: "q-bool",
          Kind: "boolean",
          Status: "judged",
          Passed: 0,
        }),
        judgmentRecord({
          TraceId: "trace-bool-skipped",
          QuestionId: "q-bool",
          Kind: "boolean",
          Status: "skipped",
          Passed: null,
          Error: "text too short",
        }),
        judgmentRecord({
          TraceId: "trace-bool-failed",
          QuestionId: "q-bool",
          Kind: "boolean",
          Status: "failed",
          Passed: null,
          Error: "classifier error",
        }),
        judgmentRecord({
          TraceId: "trace-score-judged",
          QuestionId: "q-score",
          Kind: "score",
          Status: "judged",
          Passed: null,
          Score: 0.8,
        }),
        judgmentRecord({
          TraceId: "trace-score-skipped",
          QuestionId: "q-score",
          Kind: "score",
          Status: "skipped",
          Passed: null,
          Error: "text too short",
        }),
        judgmentRecord({
          TraceId: "trace-cat-failed",
          QuestionId: "q-cat",
          Kind: "category",
          Status: "failed",
          Passed: null,
          Error: "classifier error",
        }),
      ]);
    }, 120_000);

    afterAll(async () => {
      if (!ch) return;
      await ch.exec({
        query: "ALTER TABLE instant_eval_judgments DELETE WHERE TenantId = {tenantId:String}",
        query_params: { tenantId },
      });
      await ch.close();
    });

    describe("given a run with passed, failed-check, skipped and errored judgements across boolean and non-boolean questions", () => {
      describe("when the results are read with matched set to false", () => {
        /** @scenario "Unmatched results include skipped and failed judgements whose passed verdict is unset" */
        it("returns skipped, failed and non-passing rows for matched=false, including with status filters", async () => {
          const base = { projectId: tenantId, runId, writtenFrom, writtenUntil, limit: 20 };

          const unmatched = await judgments.getPage({ ...base, matched: false });
          const skippedOnly = await judgments.getPage({
            ...base,
            matched: false,
            status: "skipped",
          });
          const failedOnly = await judgments.getPage({ ...base, matched: false, status: "failed" });

          expect(unmatched.judgments.map((row) => row.traceId)).toEqual([
            "trace-bool-fail",
            "trace-bool-failed",
            "trace-bool-skipped",
            "trace-cat-failed",
            "trace-score-skipped",
          ]);
          expect(skippedOnly.judgments.map((row) => row.traceId)).toEqual([
            "trace-bool-skipped",
            "trace-score-skipped",
          ]);
          expect(failedOnly.judgments.map((row) => row.traceId)).toEqual([
            "trace-bool-failed",
            "trace-cat-failed",
          ]);
        });
      });

      describe("when the results are read with matched set to true", () => {
        it("returns only passed boolean rows and judged non-boolean rows", async () => {
          const matched = await judgments.getPage({
            projectId: tenantId,
            runId,
            writtenFrom,
            writtenUntil,
            limit: 20,
            matched: true,
          });

          expect(matched.judgments.map((row) => row.traceId)).toEqual([
            "trace-bool-pass",
            "trace-score-judged",
          ]);
        });
      });
    });
  },
);
