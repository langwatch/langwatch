import type { RestCredentialPrincipal } from "@langwatch/api/rest";
import { moduleApi } from "@langwatch/kernel/module-api";
import type { Instant } from "@langwatch/time";

import type { InstantEvalJudgmentStatus } from "./instant-eval-limits.ts";
import type {
  InstantEvalEstimateWire,
  InstantEvalResultsWire,
  InstantEvalRunWire,
  InstantEvalSampleWire,
  InstantEvalShorthandInput,
} from "./instant-eval.schemas.ts";

/**
 * What a caller sends to start or price a run: a statement or a target, never
 * both and never neither. A target is expanded into a statement first, so
 * every field below it describes that statement too.
 */
export interface InstantEvalRunInput {
  readonly sql?: string;
  readonly parameters?: Readonly<Record<string, unknown>>;
  /** A target, a trace filter and the questions, in place of a statement. */
  readonly shorthand?: InstantEvalShorthandInput;
  readonly name?: string;
  /**
   * Rows the run may judge. Ten thousand on every plan rather than the plan's
   * own cap: a run is charged for what it judges, so an absent field must not
   * silently bill a paid plan for ten times what the caller meant to ask for.
   */
  readonly limit?: number;
}

/**
 * Who is asking. A run executes a statement as the project's restricted
 * identity, and what that statement may read is the asker's own protections:
 * a member's, resolved from their session, or a credential's.
 */
export type InstantEvalActor =
  | Readonly<{ kind: "member"; userId: string }>
  | Readonly<{ kind: "credential"; credential: RestCredentialPrincipal }>;

/** One run's counters, which is all a chip and a progress bar read. */
export interface InstantEvalRunProgress {
  readonly id: string;
  readonly status: InstantEvalRunWire["status"];
  readonly total: number | null;
  readonly progress: number;
  readonly matched: number | null;
  readonly failed: number;
  readonly skipped: number;
  /** The code of the failure that ended the run, when one did. */
  readonly error: string | null;
  readonly priceUsd: number;
  readonly finishedAtMs: number | null;
}

/**
 * The Instant Evals capability: one LangWatchQL statement judged as a job, so
 * every read is a poll of what the pipeline wrote. Creating, estimating,
 * cancelling and sampling arrive with the run service they call.
 */
export interface InstantEvalApi {
  /** Whether this project may run Instant Evals at all. */
  isEnabled(input: { projectId: string }): Promise<boolean>;

  /**
   * The product decision alone, whatever the deployment has configured: a
   * released project with no judge still gets the "configure a model" primer.
   */
  isReleased(input: { projectId: string }): Promise<boolean>;

  /**
   * Accepts a statement, holds its price against the free budget, records the
   * run and queues it. Everything after this is the pipeline's.
   */
  createRun(input: {
    projectId: string;
    actor: InstantEvalActor;
    input: InstantEvalRunInput;
  }): Promise<InstantEvalRunWire>;

  /** What the run would read and what judging it would cost, judging nothing. */
  estimateRun(input: {
    projectId: string;
    actor: InstantEvalActor;
    input: InstantEvalRunInput;
  }): Promise<InstantEvalEstimateWire>;

  /** Asks a run to stop. A run that already finished is refused by name. */
  cancelRun(input: {
    projectId: string;
    runId: string;
    requestedByUserId?: string;
  }): Promise<InstantEvalRunWire>;

  /** A few of a run's rows, with the text that was judged beside the verdict. */
  getSample(input: {
    projectId: string;
    actor: InstantEvalActor;
    runId: string;
    rows: number;
  }): Promise<InstantEvalSampleWire>;

  /** The project's runs, newest first. Empty when it has none. */
  findRuns(input: {
    projectId: string;
    limit: number;
    /** With `beforeId`: the two together are the list's cursor. */
    before?: Instant;
    beforeId?: string;
  }): Promise<InstantEvalRunWire[]>;

  getRun(input: { projectId: string; runId: string }): Promise<InstantEvalRunWire>;

  /** One page of a run's judgements. */
  getResultsPage(input: {
    projectId: string;
    runId: string;
    limit: number;
    questionId?: string;
    isMatched?: boolean;
    status?: InstantEvalJudgmentStatus;
    cursor?: string;
  }): Promise<InstantEvalResultsWire>;

  /**
   * The counters of the runs a client named, dropping ids it may not read.
   * Lenient by design: the read carrying them is the list the user is looking
   * at, and a refusal there would blank the table for a chip matching nothing.
   */
  findRunProgress(input: {
    projectId: string;
    runIds: readonly string[];
  }): Promise<InstantEvalRunProgress[]>;
}

export const InstantEvalApi = moduleApi<InstantEvalApi>()("instant-eval");
