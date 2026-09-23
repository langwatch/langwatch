/**
 * What a run would read and what judging it would cost, measured without
 * judging anything. @see specs/instant-evals/instant-eval-api.feature
 */

import type {
  LangWatchQLExecuteInput,
  LangWatchQLQueryResult,
} from "@langwatch/analytics-contract";
import { INSTANT_EVAL_CLASSIFIER_LIMITS } from "@langwatch/instant-eval-contract";
import { describe, expect, it } from "vitest";

import { INSTANT_EVAL_PRICING } from "../../rules/instant-eval-pricing.rules.ts";
import {
  InstantEvalEstimateService,
  type InstantEvalTextSource,
} from "../instant-eval-estimate.service.ts";
import {
  InstantEvalRowSourceService,
  type InstantEvalStatementRunner,
} from "../instant-eval-row-source.service.ts";
import type { AcceptedInstantEvalStatement } from "../instant-eval-statement.service.ts";

const CALLER = { id: "project-1", lwqlKey: "lwql-secret" };
const PROTECTIONS = {};

const ACCEPTED: AcceptedInstantEvalStatement = {
  sql: "SELECT TraceId, eval(conversation(ConversationId), 'x') AS annoyed FROM analytics.traces",
  parameters: {},
  questions: [
    {
      id: "annoyed",
      function: "eval",
      kind: "boolean",
      reads: "probability",
      question: { id: "annoyed", kind: "boolean", instructions: "annoyed?" },
      threshold: 0.5,
    },
  ],
  plan: [{ column: "annoyed", function: "eval", options: ["annoyed?"] }],
  keyColumns: [],
  columns: [{ name: "TraceId", type: "String" }],
};

/** An Analytics peer answering each wrapper pass by the shape it recognises. */
class ScriptedRunner implements InstantEvalStatementRunner {
  constructor(private readonly total: number) {}

  async executeLangWatchQL(input: LangWatchQLExecuteInput): Promise<LangWatchQLQueryResult> {
    const rows = input.sql.startsWith("SELECT count()")
      ? [{ total: this.total }]
      : [...Array(Math.min(this.total, 50)).keys()].map((index) => ({ TraceId: `t${index}` }));

    return {
      columns: [{ name: "TraceId", type: "String" }],
      rows,
      statistics: { elapsedMs: 1, rowsRead: rows.length, bytesRead: 1, rowsReturned: rows.length },
      diagnostics: [],
      followsTimeWindow: true,
      followsGranularity: true,
    };
  }
}

/** The extraction pass, answering one text per sampled trace. */
class ScriptedTexts implements InstantEvalTextSource {
  askedFor: string[] = [];

  constructor(private readonly bytesPerText: number) {}

  async texts(input: { traceIds: readonly string[] }): Promise<readonly Record<string, unknown>[]> {
    this.askedFor = [...input.traceIds];

    return input.traceIds.map(() => ({ annoyed: "x".repeat(this.bytesPerText) }));
  }
}

function harness({ total, bytesPerText = 400 }: { total: number; bytesPerText?: number }) {
  const textSource = new ScriptedTexts(bytesPerText);
  const estimates = InstantEvalEstimateService.create({
    rowSource: InstantEvalRowSourceService.create({ analytics: new ScriptedRunner(total) }),
    textSource,
    judge: { limits: INSTANT_EVAL_CLASSIFIER_LIMITS, pricing: INSTANT_EVAL_PRICING },
  });

  return { estimates, textSource };
}

describe("given a statement a run was accepted for", () => {
  describe("when the run is estimated", () => {
    /** @scenario "An estimate counts the rows and prices them without judging any" */
    it("counts the rows and prices one request per row", async () => {
      const { estimates } = harness({ total: 200 });

      const estimate = await estimates.estimateRun({
        caller: CALLER,
        protections: PROTECTIONS,
        accepted: ACCEPTED,
        rowLimit: 10_000,
      });

      expect(estimate.rows).toBe(200);
      expect(estimate.requests).toBe(200);
      expect(estimate.isRowsCapped).toBe(false);
      expect(estimate.avgTokens).toBeGreaterThan(0);
      expect(estimate.totalTokens).toBe(estimate.avgTokens * 200);
      expect(estimate.priceUsd).toBeGreaterThan(estimate.costUsd);
    });

    /** @scenario "The average token count comes from a sample rather than from every row" */
    it("measures the texts of a sample rather than of the selection", async () => {
      const { estimates, textSource } = harness({ total: 5_000 });

      await estimates.estimateRun({
        caller: CALLER,
        protections: PROTECTIONS,
        accepted: ACCEPTED,
        rowLimit: 10_000,
      });

      expect(textSource.askedFor).toHaveLength(50);
    });

    /** @scenario "An estimate over more rows than the cap reports the cap it was bounded to" */
    it("reports the cap when the selection is larger than the run may judge", async () => {
      const { estimates } = harness({ total: 12_000 });

      const estimate = await estimates.estimateRun({
        caller: CALLER,
        protections: PROTECTIONS,
        accepted: ACCEPTED,
        rowLimit: 10_000,
      });

      expect(estimate.rows).toBe(10_000);
      expect(estimate.isRowsCapped).toBe(true);
    });
  });

  describe("when the statement matches nothing", () => {
    it("prices nothing and reads no text", async () => {
      const { estimates, textSource } = harness({ total: 0 });

      const estimate = await estimates.estimateRun({
        caller: CALLER,
        protections: PROTECTIONS,
        accepted: ACCEPTED,
        rowLimit: 10_000,
      });

      expect(estimate).toMatchObject({ rows: 0, requests: 0, totalTokens: 0, costUsd: 0 });
      expect(textSource.askedFor).toEqual([]);
    });
  });

  describe("when a read behind the estimate fails", () => {
    it("answers that the estimate is unavailable rather than a wrong price", async () => {
      const estimates = InstantEvalEstimateService.create({
        rowSource: InstantEvalRowSourceService.create({
          analytics: {
            executeLangWatchQL: () => Promise.reject(new Error("clickhouse is down")),
          },
        }),
        textSource: new ScriptedTexts(10),
        judge: { limits: INSTANT_EVAL_CLASSIFIER_LIMITS, pricing: INSTANT_EVAL_PRICING },
      });

      await expect(
        estimates.estimateRun({
          caller: CALLER,
          protections: PROTECTIONS,
          accepted: ACCEPTED,
          rowLimit: 10_000,
        }),
      ).rejects.toMatchObject({ code: "instant_eval_estimate_unavailable" });
    });
  });
});
