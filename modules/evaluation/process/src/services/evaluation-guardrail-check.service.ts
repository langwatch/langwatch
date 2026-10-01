import type {
  EvaluationCostRecord,
  EvaluationSlugMatch,
  GuardrailCheckInput,
  GuardrailCheckOutcome,
  RunEvaluatorInput,
} from "@langwatch/evaluation-contract";
import type { SingleEvaluationResult } from "@langwatch/evaluator-contract";
import { generate } from "@langwatch/ksuid";
import { createLogger } from "@langwatch/observability";

const logger = createLogger("langwatch:evaluation:guardrail-check");

/** Mirrors evaluations-legacy.rest.ts, so guardrail costs share the ledger's id prefix. */
const COST_KSUID_PREFIX = "cost";
const DEADLINE_PASSED = Symbol("guardrail deadline passed");

/**
 * Runs one guardrail's evaluator under the caller's signal and its own deadline, answering by
 * then even when the evaluator ignores the abort. The cost is recorded after the result, outside
 * the cancellation, so reporting never delays the verdict.
 */
type GuardrailRunner = {
  runEvaluation(input: RunEvaluatorInput): Promise<SingleEvaluationResult>;
};
type GuardrailCostLedger = {
  recordCost(input: EvaluationCostRecord): Promise<EvaluationSlugMatch>;
};

export class EvaluationGuardrailCheckService {
  private constructor(
    private readonly runner: GuardrailRunner,
    private readonly ledger: GuardrailCostLedger,
  ) {}

  static create(input: {
    runner: GuardrailRunner;
    ledger: GuardrailCostLedger;
  }): EvaluationGuardrailCheckService {
    return new EvaluationGuardrailCheckService(input.runner, input.ledger);
  }

  async check(input: GuardrailCheckInput): Promise<GuardrailCheckOutcome> {
    const deadline = new AbortController();
    const timer =
      input.deadlineMs === undefined
        ? undefined
        : setTimeout(() => deadline.abort(DEADLINE_PASSED), input.deadlineMs);
    const signal = input.signal
      ? AbortSignal.any([deadline.signal, input.signal])
      : deadline.signal;
    const stopped = (): GuardrailCheckOutcome => ({
      status: "stopped",
      by: signal.reason === DEADLINE_PASSED ? "deadline" : "cancelled",
    });

    try {
      if (signal.aborted) return stopped();
      const result = await untilAborted({
        signal,
        work: this.runner.runEvaluation({
          projectId: input.projectId,
          evaluatorType: input.evaluatorType,
          data: { type: "default", data: input.data },
          settings: input.settings,
          signal,
        }),
      });
      void this.recordCost({ input, result });

      return { status: "evaluated", result };
    } catch (error) {
      if (signal.aborted) return stopped();
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  private async recordCost({
    input,
    result,
  }: {
    input: GuardrailCheckInput;
    result: SingleEvaluationResult;
  }): Promise<void> {
    if (result.status === "error" || !result.cost) return;

    try {
      await this.ledger.recordCost({
        id: generate(COST_KSUID_PREFIX).toString(),
        projectId: input.projectId,
        costType: "GUARDRAIL",
        costName: input.guardrail.name,
        referenceType: "CHECK",
        referenceId: input.guardrail.monitorId,
        amount: result.cost.amount,
        currency: result.cost.currency,
        extraInfo: {
          guardrail_id: input.guardrail.id,
          decision: result.status === "processed" && result.passed === false ? "block" : "allow",
        },
      });
    } catch (error) {
      logger.warn(
        { guardrailId: input.guardrail.id, projectId: input.projectId, error },
        "guardrail cost not recorded",
      );
    }
  }
}

/** Settles with the work, or rejects as soon as the signal aborts even if the work ignores it. */
function untilAborted<T>({ work, signal }: { work: Promise<T>; signal: AbortSignal }): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => reject(signal.reason);
    if (signal.aborted) {
      onAbort();
      return;
    }
    signal.addEventListener("abort", onAbort, { once: true });
    work
      .finally(() => signal.removeEventListener("abort", onAbort))
      .then(resolve)
      .catch(reject);
  });
}
