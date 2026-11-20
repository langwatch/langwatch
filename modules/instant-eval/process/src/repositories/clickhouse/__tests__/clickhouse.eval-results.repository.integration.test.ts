/** @vitest-environment node */

/**
 * `eval_results` against the migrated table: the recall answers the tenant's latest judged row
 * of a key and nothing else, and judge calls are counted from judged rows. Needs the migrated
 * ClickHouse the running job supplies.
 * @see modules/instant-eval/specs/instant-eval-results.feature
 */
import { randomUUID } from "node:crypto";

import type { ClickHouseClient } from "@clickhouse/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { EVAL_RESULTS_KEY_VERSION } from "../../../rules/eval-results-key.rules.ts";
import type { EvalResultRecord } from "../../eval-results.repository.ts";
import { ClickHouseEvalResultsRepository } from "../clickhouse.eval-results.repository.ts";
import {
  createTestClickHouseClient,
  testClickHouseUrl,
} from "./support/clickhouse-endpoint.support.ts";

const clickHouseUrl = testClickHouseUrl();
const DAY_MS = 24 * 60 * 60 * 1000;
const tag = randomUUID();
const tenant = `${tag}-tenant`;
const other = `${tag}-other`;
const now = Date.now();
const occurredAt = now - 2 * DAY_MS;
const JUDGE = "langwatch/instant-evals";
const KEY = { traceId: `${tag}-trace`, spanId: "", questionHash: "question", inputHash: "input" };

let ch: ClickHouseClient;
let results: ClickHouseEvalResultsRepository;

function row(overrides: Partial<EvalResultRecord> = {}): EvalResultRecord {
  return {
    TenantId: tenant,
    TraceId: KEY.traceId,
    SpanId: KEY.spanId,
    QuestionHash: KEY.questionHash,
    Question: "Is the customer annoyed?",
    Kind: "boolean",
    JudgeModel: JUDGE,
    InputHash: KEY.inputHash,
    JudgedColumn: "llm_readable_trace",
    KeyVersion: EVAL_RESULTS_KEY_VERSION,
    Source: "ask",
    SourceId: "query:1",
    Status: "judged",
    Score: null,
    Label: "",
    Probability: 0.5,
    Probabilities: "",
    Error: "",
    OccurredAt: occurredAt,
    JudgedAt: now - DAY_MS,
    UpdatedAt: now - DAY_MS,
    _retention_days: 30,
    ...overrides,
  };
}

describe.skipIf(!clickHouseUrl)("eval_results (real ClickHouse)", () => {
  beforeAll(async () => {
    ch = createTestClickHouseClient(clickHouseUrl as URL);
    results = ClickHouseEvalResultsRepository.create({ resolveClient: async () => ch });
    await results.insert([
      row({ SourceId: "run-a", JudgedAt: now - 3 * DAY_MS, Probability: 0.1 }),
      row({ SourceId: "run-b", JudgedAt: now - DAY_MS, UpdatedAt: now - DAY_MS, Probability: 0.2 }),
      row({ SourceId: "run-c", JudgedAt: now - DAY_MS, UpdatedAt: now - DAY_MS, Probability: 0.3 }),
      row({ SourceId: "query:9", JudgedAt: now, Status: "failed", Probability: null }),
      row({ SourceId: "query:8", JudgedAt: now, JudgeModel: "azure/decisions:gpt-6-luna" }),
    ]);
    await results.insert([row({ TenantId: other, SourceId: "query:7", JudgedAt: now })]);
  }, 120_000);

  afterAll(async () => {
    if (!ch) return;
    await ch.exec({
      query: "ALTER TABLE eval_results DELETE WHERE TenantId IN ({tenants:Array(String)})",
      query_params: { tenants: [tenant, other] },
    });
    await ch.close();
  });

  describe("given judged, failed and other-tenant rows in eval_results", () => {
    describe("when a key is recalled", () => {
      /** @scenario "Kept results are recalled from ClickHouse by their key" */
      it("answers only the tenant's latest judged row of that key, and counts judged rows", async () => {
        const recalled = await results.findLatestJudged({
          tenantId: tenant,
          judgeModel: JUDGE,
          keyVersion: EVAL_RESULTS_KEY_VERSION,
          keys: [KEY, { ...KEY, inputHash: "nothing kept" }],
          occurredFrom: occurredAt - DAY_MS,
          occurredUntil: occurredAt + DAY_MS,
        });

        expect(recalled).toEqual([
          {
            ...KEY,
            sourceId: "run-c",
            score: null,
            label: null,
            probability: 0.3,
            probabilities: null,
            judgedAt: now - DAY_MS,
            updatedAt: now - DAY_MS,
          },
        ]);
        await expect(results.countJudged({ projectIds: [tenant] })).resolves.toBe(4);
        await expect(
          results.countJudged({ projectIds: [tenant], since: now - 2 * DAY_MS }),
        ).resolves.toBe(3);
      });
    });

    describe("when the window misses the trace's time", () => {
      it("answers nothing", async () => {
        await expect(
          results.findLatestJudged({
            tenantId: tenant,
            judgeModel: JUDGE,
            keyVersion: EVAL_RESULTS_KEY_VERSION,
            keys: [KEY],
            occurredFrom: occurredAt + DAY_MS,
            occurredUntil: occurredAt + 2 * DAY_MS,
          }),
        ).resolves.toEqual([]);
      });
    });
  });
});
