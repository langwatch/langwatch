/**
 * The Instant Eval run's application service: what a caller can do to a run.
 *
 * Seven operations, and the shape of every one of them is the same: check the
 * gate, resolve the tenant's own capability, do the one thing, never reach for
 * a repository a route could have reached for itself.
 *
 * Two of them cost money and neither does it here. `create` accepts a statement
 * and hands the work to the queue; `estimate` reads the keys and measures a
 * sample of texts without judging any of them. The judging is the pipeline's,
 * which is what lets a hundred thousand rows be a job rather than a request
 * somebody holds open.
 *
 * @see ./statement.ts: what makes a statement acceptable
 * @see ../../../event-sourcing/pipelines/instant-eval-processing/pipeline.ts
 */

import { generate } from "@langwatch/ksuid";
import { createLogger } from "@langwatch/observability";

import type { LangWatchQLService } from "~/server/analytics/lwql";
import type { Protections } from "~/server/traces/protections";
import { KSUID_RESOURCES } from "~/utils/constants";
import type { InstantEvalClassifier } from "../classifier/classifier";
import { instantEvalCostUsd, instantEvalPriceUsd } from "../classifier/pricing";
import { estimateInstantEvalRequestTokens } from "../classifier/token-budget";
import type { InstantEvalCancellations } from "./cancellation";
import {
  INSTANT_EVAL_SAMPLE_CEILING,
  instantEvalRowLimitOrRefuse,
} from "./caps";
import {
  InstantEvalAlreadyFinishedError,
  InstantEvalEstimateUnavailableError,
  InstantEvalNotEnabledError,
  InstantEvalRowCapExceededError,
  InstantEvalRunNotFoundError,
} from "./errors";
import type {
  InstantEvalJudgmentPage,
  InstantEvalJudgmentsRepository,
} from "./instant-eval-judgments.repository";
import {
  instantEvalAverageTextBytes,
  instantEvalHydrationPlan,
} from "./instant-eval-run.executor";
import type { InstantEvalRunRepository } from "./instant-eval-run.repository";
import type { InstantEvalJudgmentStatus } from "./judgments";
import { readInstantEvalRunQuestions } from "./questions";
import type { InstantEvalRowSource, InstantEvalRunCaller } from "./row-source";
import {
  type AcceptedInstantEvalStatement,
  acceptInstantEvalStatement,
} from "./statement";

const logger = createLogger("langwatch:instant-evals:run-service");

/** Rows an estimate measures the text size of. */
const INSTANT_EVAL_ESTIMATE_SAMPLE = 50;

/** What a caller sends to start or price a run. */
export interface InstantEvalRunInput {
  readonly sql: string;
  readonly parameters?: Readonly<Record<string, unknown>>;
  readonly name?: string;
  /** Rows the run may judge. Defaults to the plan's own cap. */
  readonly limit?: number;
}

/** What a run would cost before it is started. */
export interface InstantEvalEstimate {
  readonly rows: number;
  /** Whether the statement matched more rows than the run may judge. */
  readonly rowsCapped: boolean;
  readonly avgTokens: number;
  readonly totalTokens: number;
  /** Classifications the run would make, which is one per judged text. */
  readonly requests: number;
  readonly costUsd: number;
  readonly priceUsd: number;
}

/** The two commands a caller's action sends. */
export interface InstantEvalRunCommands {
  requestRun(args: {
    tenantId: string;
    occurredAt: number;
    runId: string;
    name: string | null;
    sql: string;
    parameters: Record<string, unknown>;
    questions: unknown[];
    rowLimit: number;
  }): Promise<unknown>;
  requestCancel(args: {
    tenantId: string;
    occurredAt: number;
    runId: string;
    requestedByUserId: string | null;
  }): Promise<unknown>;
}

export interface InstantEvalRunServiceDependencies {
  readonly runs: InstantEvalRunRepository;
  readonly judgments: InstantEvalJudgmentsRepository;
  readonly rowSource: InstantEvalRowSource;
  readonly query: LangWatchQLService;
  readonly classifier: () => InstantEvalClassifier;
  readonly commands: () => InstantEvalRunCommands;
  readonly cancellations: InstantEvalCancellations;
  /** Whether this project may run Instant Evals at all. */
  readonly isEnabled: (input: { projectId: string }) => Promise<boolean>;
  /** The project's own query capability, and the plan that caps its runs. */
  readonly caller: (projectId: string) => Promise<InstantEvalRunCaller | null>;
  readonly plan: (projectId: string) => Promise<{
    name: string;
    isFree: boolean;
  }>;
  readonly now?: () => number;
}

export class InstantEvalRunService {
  constructor(private readonly deps: InstantEvalRunServiceDependencies) {}

  private now(): number {
    return this.deps.now?.() ?? Date.now();
  }

  /** The tenant's own capability, or the gate's refusal. */
  private async callerOrRefuse(
    projectId: string,
  ): Promise<InstantEvalRunCaller> {
    if (!(await this.deps.isEnabled({ projectId }))) {
      throw new InstantEvalNotEnabledError();
    }
    const caller = await this.deps.caller(projectId);
    // No query capability provisioned is the same condition as the feature
    // being off: there is nothing to run a statement as.
    if (!caller) throw new InstantEvalNotEnabledError();
    return caller;
  }

  /** The row limit this run may have, or the refusal naming what lifts it. */
  private async rowLimitOrRefuse({
    projectId,
    requested,
  }: {
    projectId: string;
    requested?: number;
  }): Promise<number> {
    return instantEvalRowLimitOrRefuse({
      plan: await this.deps.plan(projectId),
      ...(requested === undefined ? {} : { requested }),
    });
  }

  private async accept({
    caller,
    protections,
    input,
  }: {
    caller: InstantEvalRunCaller;
    protections: Protections;
    input: InstantEvalRunInput;
  }): Promise<AcceptedInstantEvalStatement> {
    return await acceptInstantEvalStatement({
      query: this.deps.query,
      rowSource: this.deps.rowSource,
      caller,
      protections,
      sql: input.sql,
      ...(input.parameters ? { parameters: input.parameters } : {}),
    });
  }

  /** Accepts a statement, records the run, and hands it to the queue. */
  async create({
    projectId,
    protections,
    input,
  }: {
    projectId: string;
    protections: Protections;
    input: InstantEvalRunInput;
  }) {
    const caller = await this.callerOrRefuse(projectId);
    const rowLimit = await this.rowLimitOrRefuse({
      projectId,
      ...(input.limit === undefined ? {} : { requested: input.limit }),
    });
    const accepted = await this.accept({ caller, protections, input });

    const runId = generate(KSUID_RESOURCES.INSTANT_EVAL_RUN).toString();
    const row = await this.deps.runs.create({
      id: runId,
      projectId,
      name: input.name ?? null,
      sql: accepted.sql,
      parameters: accepted.parameters,
      questions: [...accepted.questions],
      plan: [...accepted.plan],
      rowLimit,
    });

    await this.deps.commands().requestRun({
      tenantId: projectId,
      occurredAt: this.now(),
      runId,
      name: input.name ?? null,
      sql: accepted.sql,
      parameters: { ...accepted.parameters },
      questions: [...accepted.questions],
      rowLimit,
    });

    logger.info(
      { projectId, runId, rowLimit, questions: accepted.questions.length },
      "Instant Eval run requested",
    );
    return row;
  }

  /** What the run would read and what judging it would cost. */
  async estimate({
    projectId,
    protections,
    input,
  }: {
    projectId: string;
    protections: Protections;
    input: InstantEvalRunInput;
  }): Promise<InstantEvalEstimate> {
    const caller = await this.callerOrRefuse(projectId);
    const rowLimit = await this.rowLimitOrRefuse({
      projectId,
      ...(input.limit === undefined ? {} : { requested: input.limit }),
    });
    const accepted = await this.accept({ caller, protections, input });

    try {
      const keyPage = await this.deps.rowSource.keys({
        caller,
        sql: accepted.sql,
        parameters: accepted.parameters,
        keyColumns: accepted.keyColumns,
        limit: rowLimit,
      });

      const sampleIds = keyPage.keys
        .slice(0, INSTANT_EVAL_ESTIMATE_SAMPLE)
        .map((key) => key.traceId);
      const sample =
        sampleIds.length === 0
          ? []
          : await this.deps.rowSource.texts({
              caller,
              protections,
              sql: accepted.sql,
              parameters: accepted.parameters,
              calls: accepted.plan,
              traceIds: sampleIds,
            });

      const questions = accepted.questions.map((question) => question.question);
      const averageBytes = instantEvalAverageTextBytes({
        rows: sample,
        questionIds: accepted.questions.map((question) => question.id),
      });
      const classifier = this.deps.classifier();
      // Priced at what one request of the average text would send, because one
      // request carries every question about one text: that is the whole reason
      // a three-question statement costs about what a one-question one does.
      const avgTokens = estimateInstantEvalRequestTokens({
        text: "x".repeat(averageBytes),
        questions,
        limits: classifier.limits,
      });
      const rows = keyPage.keys.length;
      const totalTokens = avgTokens * rows;
      const costUsd = instantEvalCostUsd({
        inputTokens: totalTokens,
        pricing: classifier.pricing,
      });
      return {
        rows,
        rowsCapped: keyPage.hasMore,
        avgTokens,
        totalTokens,
        requests: rows,
        costUsd,
        priceUsd: instantEvalPriceUsd({ costUsd, pricing: classifier.pricing }),
      };
    } catch (error) {
      if (error instanceof InstantEvalRowCapExceededError) throw error;
      logger.error({ projectId, error }, "Instant Eval estimate failed");
      throw new InstantEvalEstimateUnavailableError({
        reasons: [error instanceof Error ? error : new Error(String(error))],
      });
    }
  }

  async list({
    projectId,
    limit,
    before,
  }: {
    projectId: string;
    limit: number;
    before?: Date;
  }) {
    await this.callerOrRefuse(projectId);
    return await this.deps.runs.list({
      projectId,
      limit,
      ...(before ? { before } : {}),
    });
  }

  async get({ projectId, runId }: { projectId: string; runId: string }) {
    await this.callerOrRefuse(projectId);
    const row = await this.deps.runs.findById({ projectId, runId });
    if (!row) throw new InstantEvalRunNotFoundError({ runId });
    return row;
  }

  /**
   * Asks a run to stop.
   *
   * The Redis hint first, then the event. In that order because the hint is
   * what a page already in flight reads, and the event is what makes the stop
   * durable: writing the event first would leave a window where the run is
   * recorded as cancelling while the page it holds carries on.
   */
  async cancel({
    projectId,
    runId,
    requestedByUserId,
  }: {
    projectId: string;
    runId: string;
    requestedByUserId?: string;
  }) {
    const row = await this.get({ projectId, runId });
    if (
      row.status === "FINISHED" ||
      row.status === "FAILED" ||
      row.status === "CANCELLED"
    ) {
      throw new InstantEvalAlreadyFinishedError({ runId, status: row.status });
    }

    await this.deps.cancellations.request({ runId });
    await this.deps.commands().requestCancel({
      tenantId: projectId,
      occurredAt: this.now(),
      runId,
      requestedByUserId: requestedByUserId ?? null,
    });
    logger.info(
      { projectId, runId },
      "Instant Eval run cancellation requested",
    );
    return row;
  }

  /** One page of the run's judgements. */
  async results({
    projectId,
    runId,
    limit,
    questionId,
    matched,
    status,
    cursor,
  }: {
    projectId: string;
    runId: string;
    limit: number;
    questionId?: string;
    matched?: boolean;
    status?: InstantEvalJudgmentStatus;
    cursor?: string;
  }): Promise<InstantEvalJudgmentPage> {
    const row = await this.get({ projectId, runId });
    return await this.deps.judgments.page({
      projectId,
      runId,
      // The run's own timestamps bound the read, which is what lets it prune
      // partitions instead of walking every month the table holds.
      writtenFrom: row.startedAt ?? row.createdAt,
      writtenUntil: row.finishedAt ?? new Date(this.now()),
      limit,
      ...(questionId === undefined ? {} : { questionId }),
      ...(matched === undefined ? {} : { matched }),
      ...(status === undefined ? {} : { status }),
      ...(cursor === undefined ? {} : { cursor }),
    });
  }

  /**
   * A few of the run's rows, with the text that was judged beside the verdict.
   *
   * The text is re-read through the statement's extraction functions rather
   * than stored, and nothing is judged again, which is what makes reading a
   * sample free. The verdicts come from the judgements the run already wrote.
   */
  async sample({
    projectId,
    protections,
    runId,
    n,
  }: {
    projectId: string;
    protections: Protections;
    runId: string;
    n: number;
  }) {
    const caller = await this.callerOrRefuse(projectId);
    const row = await this.deps.runs.findById({ projectId, runId });
    if (!row) throw new InstantEvalRunNotFoundError({ runId });

    const count = Math.max(1, Math.min(n, INSTANT_EVAL_SAMPLE_CEILING));
    const page = await this.deps.judgments.page({
      projectId,
      runId,
      writtenFrom: row.startedAt ?? row.createdAt,
      writtenUntil: row.finishedAt ?? new Date(this.now()),
      limit:
        count * Math.max(1, readInstantEvalRunQuestions(row.questions).length),
    });
    const traceIds = [
      ...new Set(page.judgments.map((judgment) => judgment.traceId)),
    ].slice(0, count);
    if (traceIds.length === 0) return { rows: [], judgments: page.judgments };

    const rows = await this.deps.rowSource.texts({
      caller,
      protections,
      sql: row.sql,
      parameters: (row.parameters ?? {}) as Record<string, unknown>,
      calls: instantEvalHydrationPlan(row.plan),
      traceIds,
    });
    return {
      rows,
      judgments: page.judgments.filter((judgment) =>
        traceIds.includes(judgment.traceId),
      ),
    };
  }
}
