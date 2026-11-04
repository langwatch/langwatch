import { AgentsApiService } from "@/client-sdk/services/agents/agents-api.service";

import { resolveCredentials } from "../../utils/apiKey";
import type { CommandResult } from "../../utils/output";
import { deployResult, parseVersionFlag } from "../../utils/versionCommands";

/** Points a deploy label at a version; the latest when no version is given. */
export const agentDeployCommand = async (
  id: string,
  label: string,
  options: { version?: string } = {},
): Promise<CommandResult> => {
  const requested = parseVersionFlag(options.version);
  await resolveCredentials();
  const service = new AgentsApiService();
  const agent = await service.get(id);
  const version = requested ?? agent.version ?? 1;
  const assigned = await service.assignLabel(agent.id, label, version);
  return deployResult({ name: agent.name, label: assigned.label, version: assigned.version });
};
