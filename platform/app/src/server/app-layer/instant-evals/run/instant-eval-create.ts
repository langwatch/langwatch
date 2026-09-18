/**
 * Accepting a run: the row, then the command that starts it.
 *
 * Two writes in one order, and the order is the whole content of this module.
 * The row goes first so a caller who reads the run back the instant it was
 * accepted finds it, which is what keeps a 202 from being followed by a 404.
 * That leaves one window: a command that never lands would leave a queued row
 * with no process to stall it, because the stall wake belongs to a process
 * that was never started. So a failed dispatch fails the row on the way out.
 *
 * @see ./statement.ts: what makes a statement acceptable
 * @see ../../../../../specs/instant-evals/instant-eval-api.feature
 */

import { generate } from "@langwatch/ksuid";
import { createLogger } from "@langwatch/observability";

import { KSUID_RESOURCES } from "~/utils/constants";
import type { InstantEvalRunRepository } from "./instant-eval-run.repository";
import type { AcceptedInstantEvalStatement } from "./statement";

const logger = createLogger("langwatch:instant-evals:create");

/** The command a caller's acceptance sends. */
export interface InstantEvalRequestRunCommand {
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
}

export async function createInstantEvalRun({
  runs,
  commands,
  projectId,
  name,
  accepted,
  rowLimit,
  now,
}: {
  runs: InstantEvalRunRepository;
  commands: InstantEvalRequestRunCommand;
  projectId: string;
  name: string | null;
  accepted: AcceptedInstantEvalStatement;
  rowLimit: number;
  now: number;
}) {
  const runId = generate(KSUID_RESOURCES.INSTANT_EVAL_RUN).toString();
  const row = await runs.create({
    id: runId,
    projectId,
    name,
    sql: accepted.sql,
    parameters: accepted.parameters,
    questions: [...accepted.questions],
    plan: [...accepted.plan],
    rowLimit,
  });

  try {
    await commands.requestRun({
      tenantId: projectId,
      occurredAt: now,
      runId,
      name,
      sql: accepted.sql,
      parameters: { ...accepted.parameters },
      questions: [...accepted.questions],
      rowLimit,
    });
  } catch (error) {
    await failUndispatched({ runs, projectId, runId, error });
    throw error;
  }

  logger.info(
    { projectId, runId, rowLimit, questions: accepted.questions.length },
    "Instant Eval run requested",
  );
  return row;
}

/**
 * Marks a run failed because its own start was never dispatched.
 *
 * Best effort: the caller is about to see the dispatch failure either way, and
 * a row left queued is a smaller problem than losing the reason. A failure
 * here is logged and swallowed for that reason.
 */
async function failUndispatched({
  runs,
  projectId,
  runId,
  error,
}: {
  runs: InstantEvalRunRepository;
  projectId: string;
  runId: string;
  error: unknown;
}): Promise<void> {
  logger.error(
    { projectId, runId, error },
    "Instant Eval run could not be dispatched; failing the row",
  );
  try {
    await runs.fail({ projectId, runId, code: "internal_error" });
  } catch (failure) {
    logger.error(
      { projectId, runId, error: failure },
      "Instant Eval run row could not be failed after a dispatch failure",
    );
  }
}
