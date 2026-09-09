import type { agentTrpc } from "@langwatch/agent-contract";
import {
  createFeatureApi,
  type ContractApiMap,
  type FeatureApi,
} from "@langwatch/api/web";

export type AgentApiMap = ContractApiMap<typeof agentTrpc>;

export const agentApi: FeatureApi<AgentApiMap> = createFeatureApi<AgentApiMap>();
