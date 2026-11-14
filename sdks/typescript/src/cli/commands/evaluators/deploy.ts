import { EvaluatorsApiService } from "@/client-sdk/services/evaluators";

import { resolveCredentials } from "../../utils/apiKey";
import type { CommandResult } from "../../utils/output";
import { deployResult, parseVersionFlag } from "../../utils/versionCommands";
import { findEvaluator } from "./findEvaluator";

/** Points a deploy label at a version; the latest when no version is given. */
export const evaluatorDeployCommand = async (
  reference: string,
  label: string,
  options: { version?: string } = {},
): Promise<CommandResult> => {
  const requested = parseVersionFlag(options.version);
  await resolveCredentials();
  const service = new EvaluatorsApiService();
  const evaluator = await findEvaluator({ service, reference });
  const version = requested ?? (await service.listVersions(evaluator.id)).data[0]?.version ?? 1;
  const assigned = await service.assignLabel(evaluator.id, label, version);
  return deployResult({ name: evaluator.name, label: assigned.label, version: assigned.version });
};
