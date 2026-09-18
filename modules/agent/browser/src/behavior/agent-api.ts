import type { agentTrpc } from "@langwatch/agent-contract";
import { createModuleApi, type ContractApiMap, type ModuleApi } from "@langwatch/api/web";

export type AgentApiMap = ContractApiMap<typeof agentTrpc>;

export const agentApi: ModuleApi<AgentApiMap> = createModuleApi<AgentApiMap>();
