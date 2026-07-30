import type { api } from "~/utils/api";
import type { TargetConfig } from "../types";

type TrpcUtils = ReturnType<typeof api.useContext>;

/**
 * Synchronously resolve a target's display name from the tRPC query cache.
 *
 * The reactive counterpart is useTargetName; this variant is for imperative
 * call sites (opening a drawer from an event handler) where a hook can't be
 * used and the name queries are already warm, because every visible target
 * header renders useTargetName and populates the same cache keys.
 *
 * Returns undefined on a cache miss so callers can fall back.
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
