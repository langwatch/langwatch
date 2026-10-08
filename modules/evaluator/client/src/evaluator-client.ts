/** The hooks Evaluator's own contract generates, and what each procedure takes and answers. */

import {
  type ContractApiMap,
  createModuleApi,
  type ModuleApi,
  type OutputsFromMap,
} from "@langwatch/api/web";
import type { evaluatorTrpc } from "@langwatch/evaluator-contract";
import { uiTokens } from "@langwatch/module";

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

/** Evaluator UI lent by token to the studio's inline evaluator node (§10.1). */

/** What the studio hands evaluator's settings form for an inline evaluator node. */
export type EvaluatorSettingsFormProps = {
  evaluatorType: string;
  initialSettings: Record<string, unknown>;
  /** Fill in the evaluator's default settings on first render. */
  applyDefaults: boolean;
  onChange: (settings: Record<string, unknown>) => void;
};

export const EvaluatorSettingsFormToken =
  uiTokens("evaluator").component<EvaluatorSettingsFormProps>("evaluatorSettingsForm");
