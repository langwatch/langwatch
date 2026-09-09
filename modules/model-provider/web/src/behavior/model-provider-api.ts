/**
 * Procedures this package calls: derived namespaces from contract, borrowed ones
 * from features not yet split. Segment names are load-bearing for React Query cache.
 */

import type { modelProviderTrpc, llmModelCostTrpc, translateTrpc } from "@langwatch/model-provider-contract";
import { createFeatureApi, type ContractApiMap } from "@langwatch/api/web";

type BorrowedProcedures = {
  organization: {
    /**
     * Declared for its cache entry. Deleting a provider changes the
     * organization graph the shell holds, so it must be invalidated.
     */
    getAll: { query: { input: { isDemo?: boolean }; output: unknown } };
  };
};

export type ModelProviderApiMap = ContractApiMap<typeof modelProviderTrpc> & ContractApiMap<typeof llmModelCostTrpc> & ContractApiMap<typeof translateTrpc> & BorrowedProcedures;

export const modelProviderApi = createFeatureApi<ModelProviderApiMap>();

export const api = modelProviderApi;
