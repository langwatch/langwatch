/**
 * Loads the things a run's targets name: prompts, agents, the committed studio workflows behind
 * workflow targets (including the one a workflow-typed agent wraps), and evaluators. A target that
 * has been deleted is reported, never skipped, so a run stops instead of reporting an empty column.
 */

import { AgentNotFoundError, type Agent } from "@langwatch/agent-contract";
import type { Evaluator } from "@langwatch/evaluator-contract";
import { ExperimentEvaluationInputError } from "@langwatch/experiment-contract";
import { createLogger } from "@langwatch/observability";
import type { VersionedPrompt } from "@langwatch/prompt-contract";
import { parseStudioWorkflow } from "@langwatch/workflow-contract";

import { promptLoadKey, workflowLoadKey } from "../rules/experiment-execution-data.rules.ts";
import type { ExecutionDataServices, LoadedWorkflow } from "./experiment-execution-data.service.ts";

const logger = createLogger("langwatch:experiment:target-loading");

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
  async loadPrompts({
    projectId,
    targets,
    services,
  }: LoadArgs): Promise<Map<string, VersionedPrompt>> {
    const loaded = new Map<string, VersionedPrompt>();
    for (const target of targets) {
      if (target.type !== "prompt" || !target.promptId) {
        continue;
      }

      const key = promptLoadKey(target);
      if (loaded.has(key)) {
        continue;
      }

      const versionInfo = target.promptVersionNumber
        ? ` version ${target.promptVersionNumber}`
        : "";
      const prompt = await services.prompts
        .findByIdOrHandle({
          idOrHandle: target.promptId,
          projectId,
          version: target.promptVersionNumber ?? undefined,
        })
        .catch((promptError: unknown) => {
          logger.error(
            {
              error: promptError,
              promptId: target.promptId,
              version: target.promptVersionNumber,
            },
            "Failed to load prompt for target",
          );
          const message = promptError instanceof Error ? promptError.message : String(promptError);
          throw new ExperimentEvaluationInputError({
            status: 404,
            reason: `Failed to load prompt "${target.promptId}"${versionInfo}: ${message}`,
          });
        });
      if (!prompt) {
        throw new ExperimentEvaluationInputError({
          status: 404,
          reason: `Prompt "${target.promptId}"${versionInfo} not found`,
        });
      }
      loaded.set(key, prompt);
    }

    return loaded;
  }

  /**
   * Every agent an agent target names. `getById` throws rather than returning a nullable, so a
   * deleted agent is refused the same way the other loaders refuse a missing target.
   */
  async loadAgents({ projectId, targets, services }: LoadArgs): Promise<Map<string, Agent>> {
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
          throw new ExperimentEvaluationInputError({
            status: 404,
            reason: `Agent "${target.dbAgentId}" not found`,
          });
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
  async loadWorkflows({
    projectId,
    targets,
    services,
    loadedAgents,
  }: LoadArgs & {
    loadedAgents: Map<string, Agent>;
  }): Promise<Map<string, LoadedWorkflow>> {
    const loaded = new Map<string, LoadedWorkflow>();
    for (const request of this.workflowRequests({
      targets,
      loadedAgents,
    })) {
      const key = workflowLoadKey(request);
      if (loaded.has(key)) {
        continue;
      }

      const result = await this.loadPublishedWorkflow({
        projectId,
        services,
        ...request,
      });
      loaded.set(key, result);
    }

    return loaded;
  }

  /** Direct workflow targets in order, then the workflow each workflow-typed agent links to. */
  private workflowRequests({
    targets,
    loadedAgents,
  }: {
    targets: TargetForLoading[];
    loadedAgents: Map<string, Agent>;
  }): { workflowId: string; workflowVersionId?: string }[] {
    const direct = targets.flatMap((target) =>
      target.type === "workflow" && target.workflowId
        ? [
            {
              workflowId: target.workflowId,
              ...(target.workflowVersionId ? { workflowVersionId: target.workflowVersionId } : {}),
            },
          ]
        : [],
    );
    const linked = targets.flatMap((target) => {
      const agent =
        target.type === "agent" && target.dbAgentId
          ? loadedAgents.get(target.dbAgentId)
          : undefined;
      if (agent?.type !== "workflow") {
        return [];
      }

      const workflowId = agent.workflowId ?? agent.config.workflow_id;
      return workflowId ? [{ workflowId }] : [];
    });
    return [...direct, ...linked];
  }

  /** The evaluators both the evaluator configs and the evaluator targets name. */
  async loadEvaluators({
    projectId,
    targets,
    evaluators,
    services,
  }: LoadArgs & {
    evaluators: { dbEvaluatorId?: string }[];
  }): Promise<Map<string, Evaluator>> {
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
      const dbEvaluator = await services.evaluators?.findById({ id: evaluatorId, projectId });
      // Same answer as a missing prompt, agent, or workflow: say what is gone
      // and stop, rather than silently running with fewer evaluators than
      // configured.
      if (!dbEvaluator) {
        throw new ExperimentEvaluationInputError({
          status: 404,
          reason: `Evaluator "${evaluatorId}" not found`,
        });
      }

      loaded.set(evaluatorId, dbEvaluator);
    }

    return loaded;
  }

  private async loadPublishedWorkflow({
    projectId,
    services,
    workflowId,
    workflowVersionId,
  }: {
    projectId: string;
    services: ExecutionDataServices;
    workflowId: string;
    workflowVersionId?: string;
  }): Promise<LoadedWorkflow> {
    const workflow = await services.workflows.findWorkflow({ projectId, workflowId });
    if (!workflow) {
      throw new ExperimentEvaluationInputError({
        status: 404,
        reason: `Workflow "${workflowId}" not found`,
      });
    }

    const versionId = workflowVersionId ?? workflow.publishedId;
    if (!versionId) {
      throw new ExperimentEvaluationInputError({
        status: 400,
        reason: `Workflow "${workflowId}" has no committed version to evaluate`,
      });
    }

    const dsl = await services.workflows.findVersionDsl({ projectId, workflowId, versionId });
    if (!dsl) {
      throw new ExperimentEvaluationInputError({
        status: 404,
        reason: `Workflow version "${versionId}" not found`,
      });
    }

    return {
      id: workflow.id,
      name: workflow.name,
      versionId,
      dsl: parseStudioWorkflow(dsl),
    };
  }
}
