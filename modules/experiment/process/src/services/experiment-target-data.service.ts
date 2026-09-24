/**
 * Which of a run's loaded targets one cell executes: the prompt version, the agent, or the studio
 * workflow behind it — including the workflow a workflow-typed agent wraps, which has no code of
 * its own and is cached under the linked workflow's id.
 */

import type { Agent as TypedAgent } from "@langwatch/agent-contract";
import type { TargetConfig } from "@langwatch/experiment-contract";
import type { VersionedPrompt } from "@langwatch/prompt-contract";

import {
  ExperimentExecutionDataService,
  type LoadedWorkflow,
} from "./experiment-execution-data.service.ts";

/** A loaded agent, with the Studio workflow it wraps when it is a workflow-type agent. */
function loadedDataForAgent({
  agent,
  loadedWorkflows,
}: {
  agent: TypedAgent;
  loadedWorkflows?: Map<string, LoadedWorkflow>;
}): { agent: TypedAgent; workflow?: LoadedWorkflow } {
  if (agent.type !== "workflow") return { agent };
  // A workflow-type agent has no code of its own — it wraps a Studio
  // workflow, resolved by dataLoader and cached under the linked
  // workflow's id (see loadPublishedWorkflow).
  const linkedWorkflowId =
    agent.workflowId ?? (agent.config as { workflow_id?: string }).workflow_id;
  const workflow = linkedWorkflowId
    ? loadedWorkflows?.get(
        ExperimentExecutionDataService.workflowLoadKey({ workflowId: linkedWorkflowId }),
      )
    : undefined;

  return { agent, workflow };
}

export class ExperimentTargetDataService {
  private constructor() {}

  static create(): ExperimentTargetDataService {
    return new ExperimentTargetDataService();
  }

  /** Which loaded prompt, agent or workflow a target actually runs. */
  static loadedDataForTarget({
    targetConfig,
    loadedPrompts,
    loadedAgents,
    loadedWorkflows,
  }: {
    targetConfig: TargetConfig;
    loadedPrompts: Map<string, VersionedPrompt>;
    loadedAgents: Map<string, TypedAgent>;
    loadedWorkflows?: Map<string, LoadedWorkflow>;
  }): {
    prompt?: VersionedPrompt;
    agent?: TypedAgent;
    workflow?: LoadedWorkflow;
  } {
    if (targetConfig.type === "prompt" && targetConfig.promptId) {
      const prompt = loadedPrompts.get(ExperimentExecutionDataService.promptLoadKey(targetConfig));
      if (prompt) {
        return { prompt };
      }
    }

    if (targetConfig.type === "agent" && targetConfig.dbAgentId) {
      const agent = loadedAgents.get(targetConfig.dbAgentId);
      if (agent) {
        return loadedDataForAgent({ agent, loadedWorkflows });
      }
    }

    if (targetConfig.type === "workflow" && targetConfig.workflowId) {
      const workflow = loadedWorkflows?.get(
        ExperimentExecutionDataService.workflowLoadKey(targetConfig),
      );
      if (workflow) {
        return { workflow };
      }
    }

    // For local configs, no pre-loaded data needed
    return {};
  }
}
