import { AgentsApiService } from "@/client-sdk/services/agents/agents-api.service";

import { resolveCredentials } from "../../utils/apiKey";
import type { CommandResult } from "../../utils/output";
import { undeployResult } from "../../utils/versionCommands";

/** Removes a deploy label from an agent. */
export const agentUndeployCommand = async (id: string, label: string): Promise<CommandResult> => {
  await resolveCredentials();
  const service = new AgentsApiService();
  const agent = await service.get(id);
  await service.removeLabel(agent.id, label);
  return undeployResult({ name: agent.name, label });
};
