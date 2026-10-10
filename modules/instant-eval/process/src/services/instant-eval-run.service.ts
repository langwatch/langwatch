/**
 * What a caller may do to a run: the gate, the cap, the statement, the budget's
 * hold, then the unit that does it. The judging is the pipeline's, not this.
 * @see modules/instant-eval/specs/instant-eval-api.feature
 */

import type { LangWatchQLRunCaller } from "@langwatch/analytics-contract";
import {
  type InstantEvalActor,
  type InstantEvalJudgmentStatus,
  InstantEvalClassifierNotConfiguredError,
  InstantEvalNotEnabledError,
  type InstantEvalRunInput,
} from "@langwatch/instant-eval-contract";
import { createLogger } from "@langwatch/observability";
import { nowInstant, type Instant } from "@langwatch/time";

import type { InstantEvalJudgmentPage } from "../repositories/instant-eval-judgments.repository.ts";
import type { InstantEvalRunRow } from "../repositories/instant-eval-run.repository.ts";
import { instantEvalRowLimitOrRefuse } from "../rules/instant-eval-caps.rules.ts";
import { getInstantEvalQueryCapability } from "../rules/instant-eval-query-capability.rules.ts";
import type { InstantEvalCancelService } from "./instant-eval-cancel.service.ts";
import type { InstantEvalCreateService } from "./instant-eval-create.service.ts";
import type {
  InstantEvalEstimate,
  InstantEvalEstimateService,
} from "./instant-eval-estimate.service.ts";
import type { InstantEvalFreeBudgetService } from "./instant-eval-free-budget.service.ts";
import type { InstantEvalReadsService } from "./instant-eval-reads.service.ts";
import {
  InstantEvalRequestStatementService,
  type InstantEvalRequestStatementPeers,
} from "./instant-eval-request-statement.service.ts";
import type { InstantEvalSample, InstantEvalSampleService } from "./instant-eval-sample.service.ts";
import type {
  AcceptedInstantEvalStatement,
  InstantEvalStatementService,
} from "./instant-eval-statement.service.ts";
import type { InstantEvalTraceProofService } from "./instant-eval-trace-proof.service.ts";

const logger = createLogger("langwatch:instant-eval:run");

/** The plan a project's runs are capped by. */
interface InstantEvalRunPlan {
  readonly name: string;
  readonly isFree: boolean;
}

/** The peers a run is resolved through, each one question wide. */
export interface InstantEvalRunPeers extends InstantEvalRequestStatementPeers {
  /** Whether this project may run Instant Evals at all. */
  isEnabled(input: { projectId: string }): Promise<boolean>;
  /** Whether the flag alone is on for this project, whatever judge the deployment has. */
  isReleased(input: { projectId: string }): Promise<boolean>;
  /** Whether this deployment provisioned a LangWatchQL identity at all. */
  isQueryIdentityAvailable(): boolean;
  /** The restricted tenant identity and protections this asker runs as. */
  resolveCaller(input: {
    projectId: string;
    actor: InstantEvalActor;
  }): Promise<LangWatchQLRunCaller>;
  getPlan(input: { projectId: string }): Promise<InstantEvalRunPlan>;
}

/** An estimate, with what the free budget has left when one bounds the run. */
interface InstantEvalRunEstimate extends InstantEvalEstimate {
  readonly freeBudgetRemainingUsd?: number;
}

/**
 * The units one run's operations are carried out by, each narrowed to the
 * operations this surface calls: what it composes is the behaviour, never the
 * repository behind it.
 */
interface InstantEvalRunUnits {
  statements: Pick<InstantEvalStatementService, "accept">;
  creates: Pick<InstantEvalCreateService, "createRun" | "nextRunId">;
  estimates: Pick<InstantEvalEstimateService, "estimateRun">;
  cancellations: Pick<InstantEvalCancelService, "cancelRun">;
  reads: Pick<InstantEvalReadsService, "getRun" | "findRuns" | "getResultsPage">;
  samples: Pick<InstantEvalSampleService, "getSample">;
  budget: Pick<
    InstantEvalFreeBudgetService,
    "standing" | "assertWithinBudget" | "reserve" | "release"
  >;
  /** The asker's traces:view proof a filter's selection is read under. */
  proofs: Pick<InstantEvalTraceProofService, "mint">;
}

export class InstantEvalRunService {
  private readonly statements: InstantEvalRequestStatementService;

  private constructor(
    private readonly units: InstantEvalRunUnits,
    private readonly peers: InstantEvalRunPeers,
    now: () => Instant,
  ) {
    this.statements = InstantEvalRequestStatementService.create({
      peers,
      proofs: units.proofs,
      now,
    });
  }

  static create({
    units,
    peers,
    now = nowInstant,
  }: {
    units: InstantEvalRunUnits;
    peers: InstantEvalRunPeers;
    now?: () => Instant;
  }): InstantEvalRunService {
    return new InstantEvalRunService(units, peers, now);
  }

  /** Accepts a statement, holds its price, records the run and queues it. */
  async createRun({
    projectId,
    actor,
    input,
  }: {
    projectId: string;
    actor: InstantEvalActor;
    input: InstantEvalRunInput;
  }): Promise<InstantEvalRunRow> {
    const caller = await this.#callerOrRefuse({ projectId, actor });
    const rowLimit = await this.#rowLimitOrRefuse({ projectId, requested: input.limit });
    // Before the statement is accepted, so an organization past its budget is
    // told so without the probe reading anything on its behalf.
    await this.units.budget.assertWithinBudget({ projectId });
    const accepted = await this.#accept({ projectId, actor, caller, input, rowLimit });
    const runId = this.units.creates.nextRunId();
    await this.#reserve({ projectId, caller, accepted, rowLimit, runId });

    try {
      return await this.units.creates.createRun({
        projectId,
        runId,
        name: input.name ?? null,
        accepted,
        rowLimit,
      });
    } catch (error) {
      await this.#releaseQuietly({ projectId, runId });
      throw error;
    }
  }

  /** What the run would read, and what judging it would cost. */
  async estimateRun({
    projectId,
    actor,
    input,
  }: {
    projectId: string;
    actor: InstantEvalActor;
    input: InstantEvalRunInput;
  }): Promise<InstantEvalRunEstimate> {
    const caller = await this.#callerOrRefuse({ projectId, actor });
    const rowLimit = await this.#rowLimitOrRefuse({ projectId, requested: input.limit });
    const estimate = await this.units.estimates.estimateRun({
      caller: caller.project,
      protections: caller.protections,
      accepted: await this.#accept({ projectId, actor, caller, input, rowLimit }),
      rowLimit,
    });
    // An estimate is never refused by the budget: it judges nothing, and a
    // caller deciding whether to upgrade wants the price beside what is left.
    const standing = await this.units.budget.standing({ projectId });

    return standing.remainingUsd === null
      ? estimate
      : { ...estimate, freeBudgetRemainingUsd: standing.remainingUsd };
  }

  /** Asks a run to stop. Nothing here runs a statement, so nothing resolves one. */
  async cancelRun({
    projectId,
    runId,
    requestedByUserId,
  }: {
    projectId: string;
    runId: string;
    requestedByUserId?: string;
  }): Promise<InstantEvalRunRow> {
    await this.#assertEnabled(projectId);

    return this.units.cancellations.cancelRun({
      projectId,
      runId,
      ...(requestedByUserId === undefined ? {} : { requestedByUserId }),
    });
  }

  /** A few of the run's rows, with the text that was judged beside the verdict. */
  async getSample({
    projectId,
    actor,
    runId,
    rows,
  }: {
    projectId: string;
    actor: InstantEvalActor;
    runId: string;
    rows: number;
  }): Promise<InstantEvalSample> {
    const caller = await this.#callerOrRefuse({ projectId, actor });

    return this.units.samples.getSample({
      caller: caller.project,
      protections: caller.protections,
      projectId,
      runId,
      row: await this.units.reads.getRun({ projectId, runId }),
      rows,
    });
  }

  /** The project's runs, newest first. Empty when it has none. */
  async findRuns({
    projectId,
    limit,
    before,
    beforeId,
  }: {
    projectId: string;
    limit: number;
    before?: Instant;
    beforeId?: string;
  }): Promise<InstantEvalRunRow[]> {
    await this.#assertEnabled(projectId);

    return this.units.reads.findRuns({
      projectId,
      limit,
      ...(before === undefined ? {} : { before }),
      ...(beforeId === undefined ? {} : { beforeId }),
    });
  }

  /** One run, or the refusal naming the id this project has none for. */
  async getRun({
    projectId,
    runId,
  }: {
    projectId: string;
    runId: string;
  }): Promise<InstantEvalRunRow> {
    await this.#assertEnabled(projectId);

    return this.units.reads.getRun({ projectId, runId });
  }

  /** One page of a run's judgements. */
  async getResultsPage({
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
    await this.#assertEnabled(projectId);

    return this.units.reads.getResultsPage({
      projectId,
      runId,
      limit,
      ...(questionId === undefined ? {} : { questionId }),
      ...(isMatched === undefined ? {} : { isMatched }),
      ...(status === undefined ? {} : { status }),
      ...(cursor === undefined ? {} : { cursor }),
    });
  }

  /** The tenant's own capability and protections, or the gate's refusal. */
  async #callerOrRefuse({
    projectId,
    actor,
  }: {
    projectId: string;
    actor: InstantEvalActor;
  }): Promise<LangWatchQLRunCaller> {
    await this.#assertEnabled(projectId);
    const resolved = await this.peers.resolveCaller({ projectId, actor });

    return {
      project: getInstantEvalQueryCapability({
        project: { id: resolved.project.id, lwqlKey: resolved.project.lwqlKey || null },
        hasDeploymentIdentity: this.peers.isQueryIdentityAvailable(),
      }),
      protections: resolved.protections,
    };
  }

  /** Released but refused means the deployment has no judge, which the operator fixes. */
  async #assertEnabled(projectId: string): Promise<void> {
    if (await this.peers.isEnabled({ projectId })) return;
    if (await this.peers.isReleased({ projectId })) {
      throw new InstantEvalClassifierNotConfiguredError();
    }
    throw new InstantEvalNotEnabledError();
  }

  /** The row limit this run may have, or the refusal naming what lifts it. */
  async #rowLimitOrRefuse({
    projectId,
    requested,
  }: {
    projectId: string;
    requested?: number;
  }): Promise<number> {
    return instantEvalRowLimitOrRefuse({
      plan: await this.peers.getPlan({ projectId }),
      ...(requested === undefined ? {} : { requested }),
    });
  }

  /** The statement this request means, cleared for running. */
  async #accept({
    projectId,
    actor,
    caller,
    input,
    rowLimit,
  }: {
    projectId: string;
    actor: InstantEvalActor;
    caller: LangWatchQLRunCaller;
    input: InstantEvalRunInput;
    rowLimit: number;
  }): Promise<AcceptedInstantEvalStatement> {
    const statement = await this.statements.statementFor({ projectId, actor, input, rowLimit });

    return this.units.statements.accept({
      caller: caller.project,
      protections: caller.protections,
      sql: statement.sql,
      ...(statement.parameters ? { parameters: statement.parameters } : {}),
    });
  }

  /**
   * Holds the run's estimated price against the free budget before it is queued,
   * so runs accepted together share it. A paid organization holds nothing.
   */
  async #reserve({
    projectId,
    caller,
    accepted,
    rowLimit,
    runId,
  }: {
    projectId: string;
    caller: LangWatchQLRunCaller;
    accepted: AcceptedInstantEvalStatement;
    rowLimit: number;
    runId: string;
  }): Promise<void> {
    const standing = await this.units.budget.standing({ projectId });
    if (!standing.isFree) return;
    const estimate = await this.units.estimates.estimateRun({
      caller: caller.project,
      protections: caller.protections,
      accepted,
      rowLimit,
    });

    await this.units.budget.reserve({
      projectId,
      reservationId: runId,
      priceUsd: estimate.priceUsd,
    });
  }

  /**
   * A run that was never queued spends nothing, so its hold goes with it. A
   * release that fails is logged rather than raised: the caller needs the
   * reason the run was not queued, and the hold lapses on its own.
   */
  async #releaseQuietly({ projectId, runId }: { projectId: string; runId: string }): Promise<void> {
    try {
      await this.units.budget.release({ projectId, reservationId: runId });
    } catch (error) {
      logger.error(
        { projectId, runId, error },
        "Instant Eval run was not queued and its free budget hold could not be released; it lapses on its own",
      );
    }
  }
}
