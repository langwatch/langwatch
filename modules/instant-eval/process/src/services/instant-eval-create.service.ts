/**
 * Accepting a run: the row, then the command that starts it. The row first, so
 * a 202 is never followed by a 404; and a failed dispatch fails the row, which
 * nothing else would stall. @see specs/instant-evals/instant-eval-api.feature
 */

import { generate } from "@langwatch/ksuid";
import { createLogger } from "@langwatch/observability";

import type {
  InstantEvalRunDefinition,
  InstantEvalRunRepository,
  InstantEvalRunRow,
} from "../repositories/instant-eval-run.repository.ts";
import type { AcceptedInstantEvalStatement } from "./instant-eval-statement.service.ts";

const logger = createLogger("langwatch:instant-eval:create");

/**
 * The app's KSUID resource for a run row (`KSUID_RESOURCES.INSTANT_EVAL_RUN`).
 * The literal, not the constant table: the prefix is already on every id a
 * customer has seen, so it belongs with the writer that mints it.
 */
const INSTANT_EVAL_RUN_KSUID_RESOURCE = "instanteval";

/** The command a caller's acceptance sends. The api role sends, never hosts. */
export interface InstantEvalRunCommands {
  requestRun(command: {
    tenantId: string;
    occurredAt: number;
    runId: string;
    name: string | null;
    sql: string;
    parameters: Record<string, unknown>;
    questions: unknown[];
    rowLimit: number;
  }): Promise<unknown>;
}

/** A fresh run id, minted before the row so a reservation can be held under it. */
function newInstantEvalRunId(): string {
  return generate(INSTANT_EVAL_RUN_KSUID_RESOURCE).toString();
}

export class InstantEvalCreateService {
  private constructor(
    private readonly runs: InstantEvalRunRepository,
    private readonly commands: InstantEvalRunCommands,
    private readonly now: () => number,
  ) {}

  static create({
    runs,
    commands,
    now,
  }: {
    runs: InstantEvalRunRepository;
    commands: InstantEvalRunCommands;
    now: () => number;
  }): InstantEvalCreateService {
    return new InstantEvalCreateService(runs, commands, now);
  }

  async createRun({
    projectId,
    runId = newInstantEvalRunId(),
    name,
    accepted,
    rowLimit,
  }: {
    projectId: string;
    runId?: string;
    name: string | null;
    accepted: AcceptedInstantEvalStatement;
    rowLimit: number;
  }): Promise<InstantEvalRunRow> {
    const definition: InstantEvalRunDefinition = {
      id: runId,
      projectId,
      name,
      sql: accepted.sql,
      parameters: accepted.parameters,
      questions: [...accepted.questions],
      plan: [...accepted.plan],
      rowLimit,
    };
    const row = await this.runs.create(definition);

    try {
      await this.commands.requestRun({
        tenantId: projectId,
        occurredAt: this.now(),
        runId,
        name,
        sql: accepted.sql,
        parameters: { ...accepted.parameters },
        questions: [...accepted.questions],
        rowLimit,
      });
    } catch (error) {
      await this.#failUndispatched({ projectId, runId, error });
      throw error;
    }

    logger.info(
      { projectId, runId, rowLimit, questions: accepted.questions.length },
      "Instant Eval run requested",
    );

    return row;
  }

  /**
   * Marks a run failed because its own start was never dispatched. Best
   * effort: the caller sees the dispatch failure either way, and a row left
   * queued is a smaller problem than losing the reason.
   */
  async #failUndispatched({
    projectId,
    runId,
    error,
  }: {
    projectId: string;
    runId: string;
    error: unknown;
  }): Promise<void> {
    logger.error(
      { projectId, runId, error },
      "Instant Eval run could not be dispatched; failing the row",
    );
    try {
      await this.runs.fail({ projectId, runId, code: "internal_error" });
    } catch (failure) {
      logger.error(
        { projectId, runId, error: failure },
        "Instant Eval run row could not be failed after a dispatch failure",
      );
    }
  }
}
