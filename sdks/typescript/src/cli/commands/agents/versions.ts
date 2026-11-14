import { AgentsApiService } from "@/client-sdk/services/agents/agents-api.service";

import { resolveCredentials } from "../../utils/apiKey";
import type { CommandResult } from "../../utils/output";
import { versionListResult } from "../../utils/versionCommands";

/** Every version of an agent, newest first, with its deploy labels. */
export const agentVersionsCommand = async (id: string): Promise<CommandResult> => {
  await resolveCredentials();
  const service = new AgentsApiService();
  const [agent, { data }] = await Promise.all([service.get(id), service.listVersions(id)]);
  return versionListResult({ name: agent.name, versions: data });
};
