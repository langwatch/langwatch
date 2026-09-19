/**
 * The Instant Eval run's application service: what a caller can do to a run.
 *
 * Seven operations, and the shape of every one of them is the same: check the
 * gate, resolve the tenant's own capability, do the one thing, never reach for
 * a repository a route could have reached for itself.
 *
 * Two of them cost money and neither does it here. `create` accepts a statement
 * and hands the work to the queue; `estimate` counts the rows and measures a
 * sample of texts without judging any of them. The judging is the pipeline's,
 * which is what lets a hundred thousand rows be a job rather than a request
 * somebody holds open.
 *
 * The operations with logic of their own live next door: the two writes that
 * accept a run in `./instant-eval-create.ts`, the price model in
 * `./instant-eval-estimate.ts`, and the judgement reads in
 * `./instant-eval-reads.ts`. This module is the surface over them.
 *
 * @see ./instant-eval-create.ts
 * @see ./instant-eval-estimate.ts
 * @see ./instant-eval-reads.ts
 * @see ./statement.ts: what makes a statement acceptable
 * @see ../../../event-sourcing/pipelines/instant-eval-processing/pipeline.ts
 */

import { createLogger } from "@langwatch/observability";

import type { LangWatchQLService } from "~/server/analytics/lwql";
import type { InstantEvalFreeBudget } from "~/server/app-layer/usage/instant-eval-free-budget.service";
import type { Protections } from "~/server/traces/protections";
import type { InstantEvalClassifier } from "../classifier/classifier";
import type { InstantEvalShorthandInput } from "../shorthand";
import type { InstantEvalCancellations } from "./cancellation";
import { instantEvalRowLimitOrRefuse } from "./caps";
import {
  InstantEvalAlreadyFinishedError,
  InstantEvalNotEnabledError,
  InstantEvalRunNotFoundError,
} from "./errors";
import { instantEvalStatementFor } from "./input";
import { createInstantEvalRun } from "./instant-eval-create";
import {
  estimateInstantEvalRun,
  type InstantEvalEstimate,
} from "./instant-eval-estimate";
import type {
  InstantEvalJudgmentPage,
  InstantEvalJudgmentsRepository,
} from "./instant-eval-judgments.repository";
import {
  readInstantEvalResults,
  readInstantEvalSample,
} from "./instant-eval-reads";
import type { InstantEvalRunRepository } from "./instant-eval-run.repository";
import type { InstantEvalJudgmentStatus } from "./judgments";
import type { InstantEvalRowSource, InstantEvalRunCaller } from "./row-source";
import {
  type AcceptedInstantEvalStatement,
  acceptInstantEvalStatement,
} from "./statement";

const logger = createLogger("langwatch:instant-evals:run-service");

/**
 * What a caller sends to start or price a run.
 *
 * Either a statement or a shorthand, never both and never neither. The
 * shorthand is expanded into a statement before anything else happens, so
 * every field below `shorthand` describes the run that the expansion produced
 * just as much as one a caller wrote by hand.
 */
export interface InstantEvalRunInput {
  readonly sql?: string;
  readonly parameters?: Readonly<Record<string, unknown>>;
  /** A target, a trace filter and the questions, in place of a statement. */
  readonly shorthand?: InstantEvalShorthandInput;
  readonly name?: string;
  /**
   * Rows the run may judge.
   *
   * Defaults to ten thousand on every plan, not to the plan's own cap: a run
   * is charged for what it judges, so a paid plan silently taking its whole
   * hundred thousand rows because the field was absent would bill ten times
   * what the caller meant to ask for.
   */
  readonly limit?: number;
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
  /** The free budget an organization without a paid plan is bounded by. */
  readonly budget: InstantEvalFreeBudget;
  readonly now?: () => number;
  /** The seed a sample's pseudo-random order uses. Injected so a test can pin it. */
  readonly sampleSeed?: () => number;
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
    const statement = instantEvalStatementFor({
      input,
      database: this.deps.query.database,
    });
    return await acceptInstantEvalStatement({
      query: this.deps.query,
      rowSource: this.deps.rowSource,
      caller,
      protections,
      sql: statement.sql,
      ...(statement.parameters ? { parameters: statement.parameters } : {}),
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
    // Before the statement is accepted, so a free organization past its
    // budget is told so without the probe reading anything on its behalf.
    await this.deps.budget.assertWithinBudget({ projectId });
    return await createInstantEvalRun({
      runs: this.deps.runs,
      commands: this.deps.commands(),
      projectId,
      name: input.name ?? null,
      accepted: await this.accept({ caller, protections, input }),
      rowLimit,
      now: this.now(),
    });
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
    const estimate = await estimateInstantEvalRun({
      projectId,
      protections,
      caller,
      accepted: await this.accept({ caller, protections, input }),
      rowLimit,
      rowSource: this.deps.rowSource,
      classifier: this.deps.classifier(),
    });
    // An estimate is not refused by the budget: it judges nothing, and a caller
    // deciding whether to upgrade wants the price beside what is left.
    const standing = await this.deps.budget.standing({ projectId });
    return standing.remainingUsd === null
      ? estimate
      : { ...estimate, freeBudgetRemainingUsd: standing.remainingUsd };
  }

  async list({
    projectId,
    limit,
    before,
    beforeId,
  }: {
    projectId: string;
    limit: number;
    before?: Date;
    beforeId?: string;
  }) {
    await this.callerOrRefuse(projectId);
    return await this.deps.runs.list({
      projectId,
      limit,
      ...(before ? { before } : {}),
      ...(beforeId ? { beforeId } : {}),
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
   * The durable event first, then the Redis hint. In that order because the
   * event is the authority: a hint that landed while the event was refused
   * would stop the page in flight with no record that anyone asked, and the
   * stall watchdog would then report the run as failed rather than cancelled.
   * The reverse window is harmless by comparison: the run is recorded as
   * cancelling for as long as the page it holds takes to notice, which is the
   * same window a page that started a millisecond earlier already has.
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

    await this.deps.commands().requestCancel({
      tenantId: projectId,
      occurredAt: this.now(),
      runId,
      requestedByUserId: requestedByUserId ?? null,
    });
    await this.deps.cancellations.request({ runId });
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
    isMatched,
    status,
    cursor,
  }: {
    projectId: string;
    runId: string;
    limit: number;
    questionId?: string;
    isMatched?: boolean;
    status?: InstantEvalJudgmentStatus;
    cursor?: string;
  }): Promise<InstantEvalJudgmentPage> {
    return await readInstantEvalResults({
      judgments: this.deps.judgments,
      projectId,
      runId,
      row: await this.get({ projectId, runId }),
      now: this.now(),
      limit,
      ...(questionId === undefined ? {} : { questionId }),
      ...(isMatched === undefined ? {} : { isMatched }),
      ...(status === undefined ? {} : { status }),
      ...(cursor === undefined ? {} : { cursor }),
    });
  }

  /** A few of the run's rows, with the text that was judged beside the verdict. */
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

    return await readInstantEvalSample({
      judgments: this.deps.judgments,
      rowSource: this.deps.rowSource,
      caller,
      protections,
      projectId,
      runId,
      row,
      now: this.now(),
      seed: this.deps.sampleSeed?.() ?? Date.now(),
      n,
    });
  }
}
