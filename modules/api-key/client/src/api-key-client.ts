/** The hooks API keys' own contract generates, and what each procedure takes and answers. */

import type { apiKeyTrpc } from "@langwatch/api-key-contract";
import {
  type ContractApiMap,
  createModuleApi,
  type ModuleApi,
  type OutputsFromMap,
} from "@langwatch/api/web";

type ApiKeyApiMap = ContractApiMap<typeof apiKeyTrpc>;

export const apiKeyClient: ModuleApi<ApiKeyApiMap> = createModuleApi<ApiKeyApiMap>();

type InputsOf<TNode> = TNode extends { query: { input: infer TIn } }
  ? TIn
  : TNode extends { mutation: { input: infer TIn } }
    ? TIn
    : TNode extends { subscription: { input: infer TIn } }
      ? TIn
      : { [K in keyof TNode]: InputsOf<TNode[K]> };

/** What each procedure takes, as the browser sends it. */
export type ApiKeyInputs = { [K in keyof ApiKeyApiMap]: InputsOf<ApiKeyApiMap[K]> };

/** What each procedure answers, as the browser receives it. */
export type ApiKeyOutputs = OutputsFromMap<ApiKeyApiMap>;
