import { EvaluatorsApiService } from "@/client-sdk/services/evaluators";

import { resolveCredentials } from "../../utils/apiKey";
import type { CommandResult } from "../../utils/output";
import { versionListResult } from "../../utils/versionCommands";
import { findEvaluator } from "./findEvaluator";

/** Every version of an evaluator, newest first, with its deploy labels. */
export const evaluatorVersionsCommand = async (reference: string): Promise<CommandResult> => {
  await resolveCredentials();
  const service = new EvaluatorsApiService();
  const evaluator = await findEvaluator({ service, reference });
  const { data } = await service.listVersions(evaluator.id);
  return versionListResult({ name: evaluator.name, versions: data });
};
