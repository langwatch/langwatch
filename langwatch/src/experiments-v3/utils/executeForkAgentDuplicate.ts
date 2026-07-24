import { createLogger } from "@langwatch/observability";
import { nanoid } from "nanoid";

import { toaster } from "~/components/ui/toaster";
import type { TargetConfig } from "../types";
import { applyForkedAgentToTarget, planDuplicateTarget } from "./duplicateTarget";

const logger = createLogger("executeForkAgentDuplicate");

/**
 * Minimal mutation shape this handler depends on. Decoupling from the tRPC
 * router types lets the handler be exercised in a boundary test with plain
 * `vi.fn()` mutation stubs (see `__tests__/executeForkAgentDuplicate.boundary.test.tsx`),
 * while the live path still passes the real `api.agents.copy.useMutation()`
 * instance from `EvaluationsV3Table`.
 *
 * Note: `toaster` and `createLogger` are intentionally kept as module-level
 * singletons (matching the rest of the langwatch codebase — see
 * `useHandleSavePrompt.ts`, `useExecuteEvaluation.ts`, etc.). The DI surface
 * here is scoped to the *mutation* stubs, because those are the side-effects
 * under ordered-sequence assertions. Toaster/logger are leaf side-effects
 * downstream of the decisions under test; pulling them into deps would make
 * this module inconsistent with the rest of the codebase without improving
 * what the boundary test can verify.
 */
export interface ForkAgentMutationDeps {
  copyAgent: {
    mutateAsync: (input: {
      agentId: string;
      projectId: string;
      sourceProjectId: string;
    }) => Promise<{
      id: string;
      workflowId?: string;
      workflowVersionId?: string;
    }>;
  };
  publishWorkflow: {
    mutateAsync: (input: {
      projectId: string;
      workflowId: string;
      versionId: string;
    }) => Promise<unknown>;
  };
  deleteAgent: {
    mutateAsync: (input: { id: string; projectId: string }) => Promise<unknown>;
  };
}

export interface DuplicateTargetDeps extends ForkAgentMutationDeps {
  /** Adds the new target as a column on the workbench. */
  addTarget: (target: TargetConfig) => void;
  /** Opens the editor drawer for a freshly-created prompt target. */
  openTargetEditor: (target: TargetConfig) => void;
  /** Project the duplicate is being created inside. */
  projectId: string;
}

/**
 * Side-effecting half of `handleDuplicateTarget` (in
 * `components/EvaluationsV3Table.tsx`).
 *
 * The pure decision (`planDuplicateTarget`) and ID-plugging
 * (`applyForkedAgentToTarget`) live in `./duplicateTarget.ts` and are unit
 * tested there. This module wires those decisions to the ordered tRPC
 * mutation sequence that the workbench duplicate actually runs:
 *
 *   1. `agents.copy`     — fork the Agent row (and, for workflow-type
 *                          agents, the underlying Studio Workflow/Version).
 *   2. `workflow.publish` — publish the forked workflow so the new target is
 *                          immediately runnable. Skipped for code/HTTP/signature
 *                          agents (no `workflowId` on the fork result).
 *   3. `addTarget`        — add the new column with the forked ids plugged in.
 *
 * If step 2 or 3 throws after step 1 has already created an Agent row, we
 * best-effort `agents.delete` the orphan (so it does not keep counting
 * against the license `agents` quota with no target referencing it) and then
 * re-throw so the outer catch surfaces the failure to the user. Rollback
 * errors are swallowed-and-logged — the post-copy failure is the primary
 * signal and we do not want to mask it with a secondary rollback failure.
 *
 * On any failure (copy itself, or post-copy after rollback), the user sees a
 * toast and no column is added — the column pointing at the source agent would
 * reintroduce the original bug from #5879 (two columns sharing one dbAgentId).
 *
 * Prompt/evaluator targets take the shallow path: they carry their own
 * per-column draft, so a spread-only duplicate is already correct.
 */
export async function executeForkAgentDuplicate({
  target,
  deps,
}: {
  target: TargetConfig;
  deps: DuplicateTargetDeps;
}): Promise<void> {
  const plan = planDuplicateTarget(target);
  const newTargetId = `target-${nanoid(8)}`;

  if (plan.kind === "fork-agent") {
    try {
      const copied = await deps.copyAgent.mutateAsync({
        agentId: plan.sourceAgentId,
        projectId: deps.projectId,
        sourceProjectId: deps.projectId,
      });
      try {
        if (copied.workflowId && copied.workflowVersionId) {
          await deps.publishWorkflow.mutateAsync({
            projectId: deps.projectId,
            workflowId: copied.workflowId,
            versionId: copied.workflowVersionId,
          });
        }
        deps.addTarget(
          applyForkedAgentToTarget({
            baseTarget: target,
            forked: copied,
            newTargetId,
          }),
        );
      } catch (postCopyErr) {
        // Best-effort rollback: don't leave an orphaned Agent/Workflow
        // counted against the license quota with no target referencing
        // it. Swallow rollback errors — the post-copy failure is the
        // primary signal and we don't want to mask it with a secondary
        // rollback failure.
        await deps.deleteAgent
          .mutateAsync({ id: copied.id, projectId: deps.projectId })
          .catch((rollbackErr) => {
            logger.error(
              { rollbackErr, orphanedAgentId: copied.id },
              "Rollback failed after post-copy failure; orphaned Agent row remains",
            );
          });
        throw postCopyErr;
      }
    } catch (err) {
      logger.error(
        { err, sourceAgentId: plan.sourceAgentId },
        "Failed to fork agent target on duplicate; not adding the column",
      );
      toaster.create({
        title: "Failed to duplicate target",
        type: "error",
      });
    }
    return;
  }

  const newTarget: TargetConfig = { ...target, id: newTargetId };
  deps.addTarget(newTarget);
  if (newTarget.type === "prompt") {
    deps.openTargetEditor(newTarget);
  }
}
