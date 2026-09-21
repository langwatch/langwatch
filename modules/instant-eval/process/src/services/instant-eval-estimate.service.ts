/**
 * What a run would read, and what judging it would cost, without judging any
 * of it: the count bounds the rows, a sample of texts measures what one row
 * sends, and the judge's own published rate turns that into a price.
 * @see specs/instant-evals/instant-eval-api.feature
 */

import type {
  LangWatchQLAppFunctionCall,
  LangWatchQLCaller,
  LangWatchQLProtections,
} from "@langwatch/analytics-contract";
import {
  InstantEvalEstimateUnavailableError,
  InstantEvalRowCapExceededError,
  type InstantEvalClassifierLimits,
  type InstantEvalPricing,
} from "@langwatch/instant-eval-contract";
import { createLogger } from "@langwatch/observability";

import { instantEvalCostUsd, instantEvalPriceUsd } from "../rules/instant-eval-pricing.rules.ts";
import { instantEvalAverageTextBytes } from "../rules/instant-eval-run-sizing.rules.ts";
import { estimateInstantEvalRequestTokens } from "../rules/instant-eval-token-budget.rules.ts";
import type { InstantEvalRowSourceService } from "./instant-eval-row-source.service.ts";
import type { AcceptedInstantEvalStatement } from "./instant-eval-statement.service.ts";

const logger = createLogger("langwatch:instant-eval:estimate");

/** Rows an estimate measures the text size of. */
export const INSTANT_EVAL_ESTIMATE_SAMPLE = 50;

/**
 * The extraction half of a judged plan, run through Analytics: the same rows
 * with the judged columns holding the text instead of a verdict, so reading
 * what a run would judge never costs what judging it costs.
 */
export interface InstantEvalTextSource {
  texts(input: {
    project: LangWatchQLCaller;
    protections: LangWatchQLProtections;
    sql: string;
    parameters?: Readonly<Record<string, unknown>>;
    calls: readonly LangWatchQLAppFunctionCall[];
    traceIds: readonly string[];
  }): Promise<readonly Record<string, unknown>[]>;
}

/** The judge's published rates, which are what an estimate is priced at. */
export interface InstantEvalJudgeRates {
  readonly limits: InstantEvalClassifierLimits;
  readonly pricing: InstantEvalPricing;
}

/** What a run would read, and what judging it would cost. */
export interface InstantEvalEstimate {
  /** Rows the statement matches, bounded by the run's own limit. */
  readonly rows: number;
  /** Whether the statement matched more rows than the run may judge. */
  readonly isRowsCapped: boolean;
  /** Input tokens one judged row sends, measured from a sample. */
  readonly avgTokens: number;
  readonly totalTokens: number;
  /** Classifications the run would make, one per judged row. */
  readonly requests: number;
  readonly costUsd: number;
  readonly priceUsd: number;
}

export class InstantEvalEstimateService {
  private constructor(
    private readonly rowSource: InstantEvalRowSourceService,
    private readonly textSource: InstantEvalTextSource,
    private readonly judge: InstantEvalJudgeRates,
  ) {}

  static create({
    rowSource,
    textSource,
    judge,
  }: {
    rowSource: InstantEvalRowSourceService;
    textSource: InstantEvalTextSource;
    judge: InstantEvalJudgeRates;
  }): InstantEvalEstimateService {
    return new InstantEvalEstimateService(rowSource, textSource, judge);
  }

  async estimateRun({
    caller,
    protections,
    accepted,
    rowLimit,
  }: {
    caller: LangWatchQLCaller;
    protections: LangWatchQLProtections;
    accepted: AcceptedInstantEvalStatement;
    rowLimit: number;
  }): Promise<InstantEvalEstimate> {
    try {
      const { total, sample } = await this.#sampleSelection({
        caller,
        protections,
        accepted,
        rowLimit,
      });

      return this.#priceSample({ total, sample, accepted, rowLimit });
    } catch (error) {
      if (error instanceof InstantEvalRowCapExceededError) throw error;
      logger.error({ projectId: caller.id, error }, "Instant Eval estimate failed");

      throw new InstantEvalEstimateUnavailableError({
        reasons: [error instanceof Error ? error : new Error(String(error))],
      });
    }
  }

  /** How many rows the statement matches, and the texts of a sample of them. */
  async #sampleSelection({
    caller,
    protections,
    accepted,
    rowLimit,
  }: {
    caller: LangWatchQLCaller;
    protections: LangWatchQLProtections;
    accepted: AcceptedInstantEvalStatement;
    rowLimit: number;
  }): Promise<{ total: number; sample: readonly Record<string, unknown>[] }> {
    // A count rather than a read of every key: the executor's byte ceiling
    // truncates silently, so the price read before spending would be the price
    // of a smaller run than the one about to start.
    const total = await this.rowSource.count({
      caller,
      protections,
      sql: accepted.sql,
      parameters: accepted.parameters,
      limit: rowLimit + 1,
    });
    if (total === 0) return { total, sample: [] };

    // Spread across the whole selection, not its first rows: a statement's own
    // order correlates with row length on real data, and a head sample priced
    // a ten thousand row selection five times low.
    const sampled = await this.rowSource.sampleKeys({
      caller,
      protections,
      sql: accepted.sql,
      parameters: accepted.parameters,
      keyColumns: accepted.keyColumns,
      limit: INSTANT_EVAL_ESTIMATE_SAMPLE,
      total,
    });
    const traceIds = [...new Set(sampled.map((key) => key.traceId))];
    if (traceIds.length === 0) return { total, sample: [] };

    const sample = await this.textSource.texts({
      project: caller,
      protections,
      sql: accepted.sql,
      parameters: accepted.parameters,
      calls: accepted.plan,
      traceIds,
    });

    return { total, sample };
  }

  /** What judging every matched row would send, and cost, from the sample. */
  #priceSample({
    total,
    sample,
    accepted,
    rowLimit,
  }: {
    total: number;
    sample: readonly Record<string, unknown>[];
    accepted: AcceptedInstantEvalStatement;
    rowLimit: number;
  }): InstantEvalEstimate {
    const averageBytes = instantEvalAverageTextBytes({
      rows: sample,
      questionIds: accepted.questions.map((question) => question.id),
    });
    // Priced at what one request of the average text would send, because one
    // request carries every question about one text: that is why a
    // three-question statement costs about what a one-question one does.
    const avgTokens = estimateInstantEvalRequestTokens({
      text: "x".repeat(averageBytes),
      questions: accepted.questions.map((question) => question.question),
      limits: this.judge.limits,
    });
    const rows = Math.min(total, rowLimit);
    const totalTokens = avgTokens * rows;
    const costUsd = instantEvalCostUsd({ inputTokens: totalTokens, pricing: this.judge.pricing });

    return {
      rows,
      isRowsCapped: total > rowLimit,
      avgTokens,
      totalTokens,
      requests: rows,
      costUsd,
      priceUsd: instantEvalPriceUsd({ costUsd, pricing: this.judge.pricing }),
    };
  }
}
