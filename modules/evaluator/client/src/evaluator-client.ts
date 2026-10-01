/** The hooks Evaluator's own contract generates, and what each procedure takes and answers. */

import {
  type ContractApiMap,
  createModuleApi,
  type ModuleApi,
  type OutputsFromMap,
} from "@langwatch/api/web";
import type { evaluatorTrpc } from "@langwatch/evaluator-contract";

type EvaluatorApiMap = ContractApiMap<typeof evaluatorTrpc>;

export const evaluatorClient: ModuleApi<EvaluatorApiMap> = createModuleApi<EvaluatorApiMap>();

type InputsOf<TNode> = TNode extends { query: { input: infer TIn } }
  ? TIn
  : TNode extends { mutation: { input: infer TIn } }
    ? TIn
    : TNode extends { subscription: { input: infer TIn } }
      ? TIn
      : { [K in keyof TNode]: InputsOf<TNode[K]> };

/** What each procedure takes, as the browser sends it. */
export type EvaluatorInputs = { [K in keyof EvaluatorApiMap]: InputsOf<EvaluatorApiMap[K]> };

/** What each procedure answers, as the browser receives it. */
export type EvaluatorOutputs = OutputsFromMap<EvaluatorApiMap>;
