/**
 * What an agent test run needs before its child starts: the project's key, the agent's adapter data
 * and the fixed scenario.
 * @see specs/agents/agent-test-run.feature
 */

import {
  AGENT_TEST_USER_MESSAGE,
  agentTestScenarioConfig,
  type ExecuteSyncRoute,
  type ScenarioChildEnvironment,
  type ScenarioExecutionPrefetchInput,
  type ScenarioExecutionPrefetchResult,
  type ScenarioModelParametersFailureReason,
  type TargetAdapterData,
  type TargetConfig,
} from "@langwatch/scenario-contract";
import type { WorkflowApi } from "@langwatch/workflow-contract";

import { resolveExecuteSyncRoute } from "../rules/execute-sync-route.rules.ts";
import type { ScenarioExecutionPrefetchConfig } from "./scenario-execution-prefetcher.service.ts";

/** The project fields the run reads, or why they could not be read. */
export type ProjectRead =
  | { success: true; data: { organizationId: string | null } }
  | { success: false; error: string };

/** The adapter data of the target, a named failure to build it, or nothing. */
export type AdapterRead =
  | TargetAdapterData
  | { success: false; reason: ScenarioModelParametersFailureReason; message: string }
  | null;

/**
 * The reads the agent test prefetch makes, handed in by the prefetcher so
 * this module reads the project and the agent the way every run does.
 */
export interface AgentTestReads {
  project: () => Promise<ProjectRead>;
  adapter: () => Promise<AdapterRead>;
  /** The agent's display name, or nothing when the row is gone. */
  agentName: () => Promise<string | null>;
  /** The key the test's child calls LangWatch with, minted for the adapter it runs. */
  runKey: (adapter: TargetAdapterData) => Promise<string>;
}

/** A prefetch whose job always names the route a code or workflow turn posts along. */
export type AgentTestPrefetchResult =
  | Exclude<ScenarioExecutionPrefetchResult, { success: true }>
  | (Extract<ScenarioExecutionPrefetchResult, { success: true }> & {
      data: { executeSyncRoute: ExecuteSyncRoute };
    });

/** The label of the agent kind a target names, for the not-found message. */
function targetLabel(target: TargetConfig): string {
  switch (target.type) {
    case "code":
      return "Code agent";
    case "workflow":
      return "Workflow agent";
    case "connected":
      return "Connected agent";
    case "http":
      return "HTTP agent";
    default:
      return "Prompt";
  }
}

/** Reads what an agent test run needs before its child starts. */
export class AgentTestPrefetchService {
  static create({
    workflows,
  }: {
    workflows: Pick<WorkflowApi, "hasPerProjectEngines">;
  }): AgentTestPrefetchService {
    return new AgentTestPrefetchService(workflows);
  }

  private constructor(private readonly workflows: Pick<WorkflowApi, "hasPerProjectEngines">) {}

  async prefetch({
    context,
    target,
    reads,
    config,
    onChildEnvReady,
  }: {
    context: ScenarioExecutionPrefetchInput["context"];
    target: TargetConfig;
    reads: AgentTestReads;
    config: ScenarioExecutionPrefetchConfig;
    onChildEnvReady?: (environment: ScenarioChildEnvironment) => void;
  }): Promise<AgentTestPrefetchResult> {
    if (target.type === "prompt") {
      return {
        success: false,
        error: "A prompt cannot be tested this way; run a scenario against it",
      };
    }

    if (target.type === "voice") {
      return {
        success: false,
        error: "Voice agents are tested by talking to them or by running a scenario",
      };
    }

    const [project, adapterResult, agentName] = await Promise.all([
      reads.project(),
      reads.adapter(),
      reads.agentName(),
    ]);

    if (!project.success) {
      return { success: false, error: project.error };
    }

    if (adapterResult !== null && "success" in adapterResult) {
      return {
        success: false,
        error: adapterResult.message,
        reason: adapterResult.reason,
      };
    }

    if (!adapterResult) {
      return {
        success: false,
        error: `${targetLabel(target)} ${target.referenceId} not found`,
      };
    }

    const scenario = agentTestScenarioConfig({
      agentName: agentName ?? target.referenceId,
    });
    const telemetry = {
      endpoint: config.langwatchEndpoint,
      apiKey: await reads.runKey(adapterResult),
    };
    onChildEnvReady?.({ labels: scenario.labels, telemetry });

    return {
      success: true,
      data: {
        context,
        scenario,
        parameters: {},
        adapterData: adapterResult,
        nlpServiceUrl: config.nlpServiceUrl,
        executeSyncRoute: resolveExecuteSyncRoute({
          perProjectEngines: this.workflows.hasPerProjectEngines(),
          langwatchEndpoint: config.langwatchEndpoint,
          baseHost: config.publicBaseUrl ?? "",
          nlpServiceUrl: config.nlpServiceUrl,
        }),
        target,
        script: { kind: "agent_test", userMessage: AGENT_TEST_USER_MESSAGE },
      },
      telemetry,
      // An agent test run resolves no model: no simulator plays the person and
      // no judge decides, so there is nothing here for the run to record.
      resolvedModels: null,
    };
  }
}
