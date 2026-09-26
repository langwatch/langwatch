import type { agentTrpc } from "@langwatch/agent-contract";
import { createModuleApi, type ContractApiMap, type ModuleApi } from "@langwatch/api/web";

/** Model-provider's procedures this package still calls until a kit or capability offers them. */
type BorrowedProcedures = {
  modelProvider: {
    /** The project's provider rows, masked; the voice editor reads only which keys exist. */
    listAllForProjectForFrontend: {
      query: { input: { projectId: string }; output: Readonly<Record<string, unknown>>[] };
    };
  };
};

export type AgentApiMap = ContractApiMap<typeof agentTrpc> & BorrowedProcedures;

export const agentApi: ModuleApi<AgentApiMap> = createModuleApi<AgentApiMap>();
