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

/** What `instantEval.access` answers, narrowed to what the Instant Evals column reads. */
export type ModelProviderInstantEvalAccess = {
  /** LangWatch's own model may judge for this project. */
  hostedReleased: boolean;
  /** What a refused reader is offered: the switch, an admin, us, or a self-hosted reason. */
  offer: string;
};

type BorrowedProcedures = {
  instantEval: {
    access: {
      query: { input: { projectId: string }; output: ModelProviderInstantEvalAccess };
    };
  };
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
