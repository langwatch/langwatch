/**
 * Procedures this package calls: derived namespaces from contract, borrowed ones
 * from features not yet split. Segment names are load-bearing for React Query cache.
 */

import { createModuleApi, type ContractApiMap } from "@langwatch/api/web";
import type {
  modelProviderTrpc,
  llmModelCostTrpc,
  translateTrpc,
} from "@langwatch/model-provider-contract";

export type ModelProviderApiMap = ContractApiMap<typeof modelProviderTrpc> &
  ContractApiMap<typeof llmModelCostTrpc> &
  ContractApiMap<typeof translateTrpc>;

export const modelProviderApi = createModuleApi<ModelProviderApiMap>();

export const api = modelProviderApi;
