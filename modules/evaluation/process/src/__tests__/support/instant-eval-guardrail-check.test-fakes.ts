/**
 * The evaluation's real guardrail check and execution over a given judge, for a peer's suite
 * that checks a guardrail through them (ADR-174 decision 16). Every other dependency throws:
 * a judge on Instant Evals reaches none of them.
 */
import type { EvaluationApi, EvaluationCostRecord } from "@langwatch/evaluation-contract";
import type { EvaluatorApi } from "@langwatch/evaluator-contract";
import type { InstantEvalJudgeApi } from "@langwatch/instant-eval-judge-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import type { WorkflowApi } from "@langwatch/workflow-contract";

import { EvaluationExecutionService } from "../../features/execution/services/evaluation-execution.service.ts";
import { EvaluationGuardrailCheckService } from "../../features/execution/services/evaluation-guardrail-check.service.ts";

function unreachable(what: string): () => never {
  return () => {
    throw new Error(`a judge on Instant Evals never reaches ${what}`);
  };
}

/** `checkGuardrail` as the evaluation answers it, with each cost row it records kept. */
export function instantEvalGuardrailCheckOver({
  judges,
  costs = [],
}: {
  judges: Pick<InstantEvalJudgeApi, "judge">;
  costs?: EvaluationCostRecord[];
}): Pick<EvaluationApi, "checkGuardrail"> {
  const execution = EvaluationExecutionService.create({
    traces: {
      readTracesWithSpans: unreachable("a trace read"),
      readEvaluations: unreachable("a trace read"),
      readThreadsTraces: unreachable("a thread read"),
    },
    spanDigest: { format: unreachable("a span digest"), formatThread: unreachable("a thread") },
    modelEnvResolver: { resolveForEvaluator: unreachable("a model provider") },
    langevalsClient: { evaluate: unreachable("the evaluator service") },
    workflows: createApiFixture<WorkflowApi>({}),
    evaluators: createApiFixture<EvaluatorApi>({ augmentResult: ({ result }) => result }),
    workflowExecutor: { run: unreachable("a workflow") },
    judges,
    installEnvironment: {},
  });
  const check = EvaluationGuardrailCheckService.create({
    runner: { runEvaluation: (input) => execution.executeForData(input) },
    ledger: {
      recordCost: async (input) => {
        costs.push(input);
        return { id: input.id };
      },
    },
  });

  return { checkGuardrail: (input) => check.check(input) };
}
