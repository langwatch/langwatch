/** The hooks Prompt's own contract generates, and what each procedure takes and answers. */

import {
  type ContractApiMap,
  createModuleApi,
  type ModuleApi,
  type OutputsFromMap,
} from "@langwatch/api/web";
import type { promptTagTrpc, promptTrpc } from "@langwatch/prompt-contract";

type PromptApiMap = ContractApiMap<typeof promptTagTrpc> & ContractApiMap<typeof promptTrpc>;

export const promptClient: ModuleApi<PromptApiMap> = createModuleApi<PromptApiMap>();

type InputsOf<TNode> = TNode extends { query: { input: infer TIn } }
  ? TIn
  : TNode extends { mutation: { input: infer TIn } }
    ? TIn
    : TNode extends { subscription: { input: infer TIn } }
      ? TIn
      : { [K in keyof TNode]: InputsOf<TNode[K]> };

/** What each procedure takes, as the browser sends it. */
export type PromptInputs = { [K in keyof PromptApiMap]: InputsOf<PromptApiMap[K]> };

/** What each procedure answers, as the browser receives it. */
export type PromptOutputs = OutputsFromMap<PromptApiMap>;
