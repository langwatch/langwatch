/**
 * Loads the things a run's targets name: prompts, agents, the committed studio workflows behind
 * workflow targets (including the one a workflow-typed agent wraps), and evaluators. A target that
 * has been deleted is reported, never skipped, so a run stops instead of reporting an empty column.
 */

import { createLogger } from "@langwatch/observability";
import { AgentNotFoundError, type Agent } from "@langwatch/agent-contract";
import type { Evaluator } from "@langwatch/evaluator-contract";
import type { VersionedPrompt } from "@langwatch/prompt-contract";
import { parseStudioWorkflow } from "@langwatch/workflow-contract";

import {
  ExperimentExecutionDataService,
  type ExecutionDataServices,
  type LoadedWorkflow,
} from "./experiment-execution-data.service.ts";

const logger = createLogger("langwatch:experiment:target-loading");

/** The sentinel a loader returns instead of a value when a named target is gone. */
type LoadFailure = { error: string; status: number };

interface TargetForLoading {
  type: string;
  promptId?: string;
  promptVersionNumber?: number;
  dbAgentId?: string;
  targetEvaluatorId?: string;
  workflowId?: string;
  workflowVersionId?: string;
}

interface LoadArgs {
  projectId: string;
  targets: TargetForLoading[];
  services: ExecutionDataServices;
}

export class ExperimentTargetLoadingService {
  private constructor() {}

  static create(): ExperimentTargetLoadingService {
    return new ExperimentTargetLoadingService();
  }

  /** Every prompt version a prompt target names, keyed by prompt id and version. */
  static async loadPrompts({
    projectId,
    targets,
    services,
  }: LoadArgs): Promise<Map<string, VersionedPrompt> | LoadFailure> {
    const loaded = new Map<string, VersionedPrompt>();
    for (const target of targets) {
      if (target.type !== "prompt" || !target.promptId) {
        continue;
      }

      const key = ExperimentExecutionDataService.promptLoadKey(target);
      if (loaded.has(key)) {
        continue;
      }

      const versionInfo = target.promptVersionNumber
        ? ` version ${target.promptVersionNumber}`
        : "";
      try {
        const prompt = await services.prompts.tryGetPromptByIdOrHandle({
          idOrHandle: target.promptId,
          projectId,
          version: target.promptVersionNumber ?? undefined,
        });
        if (!prompt) {
          return { error: `Prompt "${target.promptId}"${versionInfo} not found`, status: 404 };
        }

        loaded.set(key, prompt);
      } catch (promptError) {
        logger.error(
          {
            error: promptError,
            promptId: target.promptId,
            version: target.promptVersionNumber,
          },
          "Failed to load prompt for target",
        );

        return {
          error: `Failed to load prompt "${target.promptId}"${versionInfo}: ${(promptError as Error).message}`,
          status: 404,
        };
      }
    }

    return loaded;
  }

  /**
   * Every agent an agent target names. `getById` throws rather than returning a nullable, so a
   * deleted agent is translated into the same sentinel shape the other loaders return.
   */
  static async loadAgents({
    projectId,
    targets,
    services,
  }: LoadArgs): Promise<Map<string, Agent> | LoadFailure> {
    const loaded = new Map<string, Agent>();
    for (const target of targets) {
      if (target.type !== "agent" || !target.dbAgentId) {
        continue;
      }

      try {
        loaded.set(
          target.dbAgentId,
          await services.agents.getById({ id: target.dbAgentId, projectId }),
        );
      } catch (error) {
        if (error instanceof AgentNotFoundError) {
          return { error: `Agent "${target.dbAgentId}" not found`, status: 404 };
        }

        throw error;
      }
    }

    return loaded;
  }

  /**
   * The committed DSL each workflow target runs per row, plus the workflow a workflow-typed agent
   * wraps: that agent has no code of its own, only a pointer, so the run dispatches the linked
   * workflow exactly as a direct workflow target would.
   */
  static async loadWorkflows({
    projectId,
    targets,
    services,
    loadedAgents,
  }: LoadArgs & {
    loadedAgents: Map<string, Agent>;
  }): Promise<Map<string, LoadedWorkflow> | LoadFailure> {
    const loaded = new Map<string, LoadedWorkflow>();
    for (const target of targets) {
      if (target.type !== "workflow" || !target.workflowId) {
        continue;
      }

      const key = ExperimentExecutionDataService.workflowLoadKey(target);
      if (loaded.has(key)) {
        continue;
      }

      const result = await ExperimentTargetLoadingService.loadPublishedWorkflow({
        projectId,
        services,
        workflowId: target.workflowId,
        workflowVersionId: target.workflowVersionId,
      });
      if ("error" in result) {
        return result;
      }

      loaded.set(key, result);
    }

    for (const target of targets) {
      if (target.type !== "agent" || !target.dbAgentId) {
        continue;
      }

      const agent = loadedAgents.get(target.dbAgentId);
      if (agent?.type !== "workflow") {
        continue;
      }

      const linkedWorkflowId =
        agent.workflowId ?? (agent.config as { workflow_id?: string }).workflow_id;
      if (!linkedWorkflowId) {
        continue;
      }

      const key = ExperimentExecutionDataService.workflowLoadKey({ workflowId: linkedWorkflowId });
      if (loaded.has(key)) {
        continue;
      }

      const result = await ExperimentTargetLoadingService.loadPublishedWorkflow({
        projectId,
        services,
        workflowId: linkedWorkflowId,
      });
      if ("error" in result) {
        return result;
      }

      loaded.set(key, result);
    }

    return loaded;
  }

  /** The evaluators both the evaluator configs and the evaluator targets name. */
  static async loadEvaluators({
    projectId,
    targets,
    evaluators,
    services,
  }: LoadArgs & {
    evaluators: Array<{ dbEvaluatorId?: string }>;
  }): Promise<Map<string, Evaluator> | LoadFailure> {
    const ids = new Set<string>();
    for (const evaluator of evaluators) {
      if (evaluator.dbEvaluatorId) {
        ids.add(evaluator.dbEvaluatorId);
      }
    }

    for (const target of targets) {
      if (target.type === "evaluator" && target.targetEvaluatorId) {
        ids.add(target.targetEvaluatorId);
      }
    }

    if (ids.size > 0 && !services.evaluators) {
      throw new Error(
        "ExecutionDataServices.evaluators is required when an execution references an evaluator",
      );
    }

    const loaded = new Map<string, Evaluator>();
    for (const evaluatorId of ids) {
      const dbEvaluator = await services.evaluators?.tryGetById({ id: evaluatorId, projectId });
      // Same answer as a missing prompt, agent, or workflow: say what is gone
      // and stop, rather than silently running with fewer evaluators than
      // configured.
      if (!dbEvaluator) {
        return { error: `Evaluator "${evaluatorId}" not found`, status: 404 };
      }

      loaded.set(evaluatorId, dbEvaluator);
    }

    return loaded;
  }

  private static async loadPublishedWorkflow({
    projectId,
    services,
    workflowId,
    workflowVersionId,
  }: {
    projectId: string;
    services: ExecutionDataServices;
    workflowId: string;
    workflowVersionId?: string;
  }): Promise<LoadedWorkflow | LoadFailure> {
    const workflow = await services.workflows.tryFindWorkflow({ projectId, workflowId });
    if (!workflow) {
      return { error: `Workflow "${workflowId}" not found`, status: 404 };
    }

    const versionId = workflowVersionId ?? workflow.publishedId;
    if (!versionId) {
      return {
        error: `Workflow "${workflowId}" has no committed version to evaluate`,
        status: 400,
      };
    }

    const dsl = await services.workflows.tryFindVersionDsl({ projectId, workflowId, versionId });
    if (!dsl) {
      return { error: `Workflow version "${versionId}" not found`, status: 404 };
    }

    return {
      id: workflow.id,
      name: workflow.name,
      versionId,
      dsl: parseStudioWorkflow(dsl),
    };
  }
}
