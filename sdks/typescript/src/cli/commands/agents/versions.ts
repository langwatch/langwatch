import { AgentsApiService } from "@/client-sdk/services/agents/agents-api.service";

import { resolveCredentials } from "../../utils/apiKey";
import type { CommandResult } from "../../utils/output";
import {
  deployResult,
  parseVersionFlag,
  undeployResult,
  versionListResult,
} from "../../utils/versionCommands";

/** Every version of an agent, newest first, with its deploy labels. */
export const agentVersionsCommand = async (id: string): Promise<CommandResult> => {
  await resolveCredentials();
  const service = new AgentsApiService();
  const [agent, { data }] = await Promise.all([service.get(id), service.listVersions(id)]);
  return versionListResult({ name: agent.name, versions: data });
};

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

/** Removes a deploy label from an agent. */
export const agentUndeployCommand = async (id: string, label: string): Promise<CommandResult> => {
  await resolveCredentials();
  const service = new AgentsApiService();
  const agent = await service.get(id);
  await service.removeLabel(agent.id, label);
  return undeployResult({ name: agent.name, label });
};
