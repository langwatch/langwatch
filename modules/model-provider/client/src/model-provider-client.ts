/** The hooks Model provider's own contract generates. */

import { type ContractApiMap, createModuleApi, type ModuleApi } from "@langwatch/api/web";
import type {
  llmModelCostTrpc,
  modelProviderTrpc,
  translateTrpc,
} from "@langwatch/model-provider-contract";

type ModelProviderClientMap = ContractApiMap<typeof modelProviderTrpc> &
  ContractApiMap<typeof llmModelCostTrpc> &
  ContractApiMap<typeof translateTrpc>;

export const modelProviderClient: ModuleApi<ModelProviderClientMap> =
  createModuleApi<ModelProviderClientMap>();
