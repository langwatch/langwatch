/** The hooks the API keys contract generates, what each procedure takes and answers, its mounts. */

import type { apiKeyTrpc } from "@langwatch/api-key-contract";
import {
  type ContractApiMap,
  createModuleApi,
  type ModuleApi,
  type OutputsFromMap,
} from "@langwatch/api/web";
import { uiTokens } from "@langwatch/module";

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

/** What the keys panel needs from whoever mounts it: the project whose keys it manages. */
export type SigningKeysPanelProps = Readonly<{ projectId: string }>;

export const SigningKeysPanelToken =
  uiTokens("api-key").component<SigningKeysPanelProps>("signingKeysPanel");
