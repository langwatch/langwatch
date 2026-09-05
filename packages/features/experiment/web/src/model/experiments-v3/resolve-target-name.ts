import type { api } from "@langwatch/workflow-web/studio-host/api";
import type { TargetConfig } from "./types";

type TrpcUtils = ReturnType<typeof api.useUtils>;

/**
 * Synchronously resolve a target's display name from the tRPC query cache.
 */
export const resolveTargetNameFromCache = ({
  target,
  utils,
  projectId,
}: {
  target: TargetConfig;
  utils: TrpcUtils;
  projectId: string | undefined;
}): string | undefined => {
  if (!projectId) return undefined;

  if (target.type === "prompt") {
    if (!target.promptId) return "New Prompt";
    const prompt = utils.prompts.getByIdOrHandle.getData({
      idOrHandle: target.promptId,
      projectId,
    });
    return prompt?.handle ?? prompt?.name ?? "New Prompt";
  }
  if (target.type === "agent") {
    return utils.agents.getById.getData({
      id: target.dbAgentId ?? "",
      projectId,
    })?.name;
  }
  if (target.type === "evaluator") {
    return utils.evaluators.getById.getData({
      id: target.targetEvaluatorId ?? "",
      projectId,
    })?.name;
  }
  return undefined;
};
