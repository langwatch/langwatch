import { EvaluatorsApiService } from "@/client-sdk/services/evaluators";

import { resolveCredentials } from "../../utils/apiKey";
import type { CommandResult } from "../../utils/output";
import { undeployResult } from "../../utils/versionCommands";
import { findEvaluator } from "./findEvaluator";

/** Removes a deploy label from an evaluator. */
export const evaluatorUndeployCommand = async (
  reference: string,
  label: string,
): Promise<CommandResult> => {
  await resolveCredentials();
  const service = new EvaluatorsApiService();
  const evaluator = await findEvaluator({ service, reference });
  await service.removeLabel(evaluator.id, label);
  return undeployResult({ name: evaluator.name, label });
};
