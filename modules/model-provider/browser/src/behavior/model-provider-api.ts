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

/** One organization of `organization.getScopeGraph`, narrowed to what the scope picker reads. */
export type ModelProviderScopeGraphOrganization = {
  id: string;
  name: string;
  teams: { id: string; name: string; projects: { id: string; name: string }[] }[];
};

type BorrowedProcedures = {
  organization: {
    getScopeGraph: {
      query: { input: Record<string, never>; output: ModelProviderScopeGraphOrganization[] };
    };
  };
};

export type ModelProviderApiMap = ContractApiMap<typeof modelProviderTrpc> &
  ContractApiMap<typeof llmModelCostTrpc> &
  ContractApiMap<typeof translateTrpc> &
  BorrowedProcedures;

export const modelProviderApi = createModuleApi<ModelProviderApiMap>();

export const api = modelProviderApi;
