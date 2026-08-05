import type { TargetConfig } from "../types";

/**
 * Plan for duplicating a target column on the workbench.
 *
 * - `shallow`: spread-only duplicate. Correct for prompt/evaluator targets,
 *   which carry their own per-column draft (`localPromptConfig`), so a shallow
 *   spread already yields an independently editable column. Also the
 *   defensive fallback for an agent target without `dbAgentId` — there is
 *   nothing to fork, so we match the prior behavior rather than drop the
 *   duplicate on the floor.
 * - `fork-agent`: the target points at a shared Agent row (and, for
 *   workflow-type agents, an underlying Studio workflow). The caller must run
 *   `agents.copy` to fork the agent before adding the new target — otherwise
 *   both columns reference the literal same `dbAgentId`, and edits leak
 *   between them (see #5879).
 *
 * Exported so the forking decision can be unit-tested without a tRPC client.
 */
export type DuplicateTargetPlan =
  | { kind: "shallow" }
  | { kind: "fork-agent"; sourceAgentId: string };

export const planDuplicateTarget = (
  target: TargetConfig,
): DuplicateTargetPlan => {
  if (target.type === "agent" && target.dbAgentId) {
    return { kind: "fork-agent", sourceAgentId: target.dbAgentId };
  }
  return { kind: "shallow" };
};

/**
 * Apply the result of `agents.copy` to a fork-agent plan, producing the new
 * target with the freshly-created agent id plugged in. For workflow-type
 * agents, `agents.copy` returns `workflowId` + `workflowVersionId` of the
 * forked workflow — surface those onto the new target so it runs its own
 * published workflow, not the source's. For non-workflow agents (code/http/
 * signature), both fields are unset and the new target keeps them empty,
 * matching a fresh agent target.
 *
 * Workflow fields are assigned unconditionally (not conditionally spread) so
 * a stale value on `baseTarget` cannot survive the fork — otherwise a
 * workflow-type agent whose forked result somehow lacked workflow ids would
 * silently keep pointing at the source's workflow, reintroducing the original
 * bug (see #5879).
 *
 * Exported so the ID-plugging logic can be unit-tested without a tRPC client.
 */
export const applyForkedAgentToTarget = ({
  baseTarget,
  forked,
  newTargetId,
}: {
  baseTarget: TargetConfig;
  forked: {
    id: string;
    workflowId?: string;
    workflowVersionId?: string;
  };
  newTargetId: string;
}): TargetConfig => ({
  ...baseTarget,
  id: newTargetId,
  dbAgentId: forked.id,
  workflowId: forked.workflowId,
  workflowVersionId: forked.workflowVersionId,
});
