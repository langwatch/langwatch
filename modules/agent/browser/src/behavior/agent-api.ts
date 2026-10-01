import type { agentTrpc, httpProxyTrpc } from "@langwatch/agent-contract";
import { createModuleApi, type ContractApiMap, type ModuleApi } from "@langwatch/api/web";

import type { blankTemplate } from "../model/workflow/templates/blank.template.ts";

/** Model-provider's procedures this package still calls until a kit or capability offers them. */
type BorrowedProcedures = {
  modelProvider: {
    /** The project's provider rows, masked; the voice editor reads only which keys exist. */
    listAllForProjectForFrontend: {
      query: { input: { projectId: string }; output: Readonly<Record<string, unknown>>[] };
    };
  };
  workflow: {
    /** Main's workflow agent is a new workflow first, then the agent that runs it. */
    create: {
      mutation: {
        input: { projectId: string; dsl: typeof blankTemplate; commitMessage: string };
        output: { workflow: { id: string } };
      };
    };
  };
};

export type AgentApiMap = ContractApiMap<typeof agentTrpc> &
  ContractApiMap<typeof httpProxyTrpc> &
  BorrowedProcedures;

export const agentApi: ModuleApi<AgentApiMap> = createModuleApi<AgentApiMap>();
