/** @vitest-environment node */

/**
 * The matched filter answers alike over the memory twin and ClickHouse, whose
 * nullable Passed column once dropped every skipped and failed row (#9741).
 * @see modules/instant-eval/specs/instant-eval-api.feature
 */
import { randomUUID } from "node:crypto";

import type { ClickHouseClient } from "@clickhouse/client";
import { Temporal } from "@langwatch/time";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type {
  InstantEvalJudgmentQuery,
  InstantEvalJudgmentRecord,
  InstantEvalJudgmentsRepository,
} from "../../instant-eval-judgments.repository.ts";
import { MemoryInstantEvalJudgmentsRepository } from "../../memory/memory.instant-eval-judgments.repository.ts";
import { ClickHouseInstantEvalJudgmentsRepository } from "../clickhouse.instant-eval-judgments.repository.ts";
import {
  createTestClickHouseClient,
  testClickHouseUrl,
} from "./support/clickhouse-endpoint.support.ts";

const clickHouseUrl = testClickHouseUrl();
const tenantId = `${randomUUID()}-matched`;
const runId = "run-matched";
const now = Date.now();

function judgment({
  traceId,
  kind,
  status,
  passed,
}: {
  traceId: string;
  kind: "boolean" | "score";
  status: InstantEvalJudgmentRecord["Status"];
  passed: number | null;
}): InstantEvalJudgmentRecord {
  return {
    TenantId: tenantId,
    RunId: runId,
    TraceId: traceId,
    QuestionId: kind === "boolean" ? "resolved" : "quality",
    ThreadId: "",
    SpanId: "",
    Kind: kind,
    Status: status,
    Passed: passed,
    Score: kind === "score" && status === "judged" ? 4 : null,
    Label: "",
    Probability: null,
    Probabilities: "",
    Error: status === "judged" ? "" : "classifier_failed",
    OccurredAt: now,
    CreatedAt: now,
    UpdatedAt: now,
  };
}

const judgments: readonly InstantEvalJudgmentRecord[] = [
  judgment({ traceId: "bool-passed", kind: "boolean", status: "judged", passed: 1 }),
  judgment({ traceId: "bool-not-passed", kind: "boolean", status: "judged", passed: 0 }),
  judgment({ traceId: "bool-skipped", kind: "boolean", status: "skipped", passed: null }),
  judgment({ traceId: "bool-failed", kind: "boolean", status: "failed", passed: null }),
  judgment({ traceId: "score-judged", kind: "score", status: "judged", passed: null }),
  judgment({ traceId: "score-skipped", kind: "score", status: "skipped", passed: null }),
  judgment({ traceId: "score-failed", kind: "score", status: "failed", passed: null }),
];

async function traceIdsOf({
  repository,
  narrowing,
}: {
  repository: InstantEvalJudgmentsRepository;
  narrowing: Pick<InstantEvalJudgmentQuery, "matched" | "status">;
}): Promise<string[]> {
  const page = await repository.getPage({
    projectId: tenantId,
    runId,
    writtenFrom: Temporal.Instant.fromEpochMilliseconds(now - 60_000),
    writtenUntil: Temporal.Instant.fromEpochMilliseconds(now + 60_000),
    limit: 100,
    ...narrowing,
  });
  return page.judgments.map((row) => row.traceId).toSorted();
}

function matchedFilterCases(repository: () => InstantEvalJudgmentsRepository): void {
  describe("when the results are read with matches excluded", () => {
    /** @scenario "Results narrowed to non-matches keep the skipped and failed judgements" */
    it("returns the yes or no judgements that did not pass with every skipped and failed one", async () => {
      const unmatched = await traceIdsOf({
        repository: repository(),
        narrowing: { matched: false },
      });
      const matched = await traceIdsOf({ repository: repository(), narrowing: { matched: true } });
      const all = await traceIdsOf({ repository: repository(), narrowing: {} });

      expect(unmatched).toEqual([
        "bool-failed",
        "bool-not-passed",
        "bool-skipped",
        "score-failed",
        "score-skipped",
      ]);
      expect([...matched, ...unmatched].toSorted()).toEqual(all);
    });
  });

  describe("when the results are read with matches excluded and the status skipped, then failed", () => {
    /** @scenario "Non-matches narrowed to skipped or failed return those judgements" */
    it("returns every judgement with that status", async () => {
      await expect(
        traceIdsOf({ repository: repository(), narrowing: { matched: false, status: "skipped" } }),
      ).resolves.toEqual(["bool-skipped", "score-skipped"]);
      await expect(
        traceIdsOf({ repository: repository(), narrowing: { matched: false, status: "failed" } }),
      ).resolves.toEqual(["bool-failed", "score-failed"]);
    });
  });
}

describe("given a run with passed, not passed, skipped and failed judgements over the memory twin", () => {
  const memory = MemoryInstantEvalJudgmentsRepository.create();
  beforeAll(() => memory.insert(judgments));

  matchedFilterCases(() => memory);
});

describe.skipIf(!clickHouseUrl)(
  "given a run with passed, not passed, skipped and failed judgements in ClickHouse",
  () => {
    let ch: ClickHouseClient;
    let clickHouse: ClickHouseInstantEvalJudgmentsRepository;

    beforeAll(async () => {
      ch = createTestClickHouseClient(clickHouseUrl as URL);
      clickHouse = ClickHouseInstantEvalJudgmentsRepository.create({
        resolveClient: async () => ch,
      });
      await clickHouse.insert(judgments);
    }, 120_000);

    afterAll(async () => {
      if (!ch) return;
      await ch.exec({
        query: "ALTER TABLE instant_eval_judgments DELETE WHERE TenantId = {tenantId:String}",
        query_params: { tenantId },
      });
      await ch.close();
    });

    matchedFilterCases(() => clickHouse);
  },
);
