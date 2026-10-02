import {
  AgentCallTimeoutError,
  AgentTestRefusedError,
  AgentOwnerOnlyError,
  connectedAgentSelectability,
  DEFAULT_CALL_TIMEOUT_MS,
  MAX_CALL_TIMEOUT_MS,
} from "@langwatch/agent-contract";
import type {
  AgentApi,
  AgentWithFields,
  AgentTestRunResult,
  AgentTestTurnResult,
} from "@langwatch/agent-contract";
import type { ApiKeyApi } from "@langwatch/api-key-contract";
import { HandledError } from "@langwatch/handled-error";
import { generate } from "@langwatch/ksuid";
import type { ModelProviderApi } from "@langwatch/model-provider-contract";
import type { ProjectApi } from "@langwatch/project-contract";
import type { PromptApi } from "@langwatch/prompt-contract";
import {
  AGENT_TEST_SCENARIO_ID,
  agentTestScenarioConfig,
  mapAgentTestTarget,
  generateBatchRunId,
  generateScenarioRunId,
  getAgentTestSetId,
  parseScenarioParameterDefinitions,
  resolveRunParameters,
  withActor,
  type RunActor,
  type SimulationService,
  type TargetConfig,
  type TestAgentRunInput,
  type TestAgentTurnInput,
  type AgentTestTurnJob,
} from "@langwatch/scenario-contract";
import type { SecretApi } from "@langwatch/secret-contract";
import { nowInstant } from "@langwatch/time";
/**
 * "Test agent": one turn sent through the same adapter a simulation turn uses (or, for a connected
 * agent, through the same live dispatcher a simulation's connected column uses),
 * @see specs/agents/agent-test-run.feature
 */
import type { WorkflowApi } from "@langwatch/workflow-contract";
import { z } from "zod";

import type { AgentTestTurnChild } from "../app/scenario.app.ts";
import {
  AgentTestPrefetchService,
  type AdapterRead,
  type ProjectRead,
} from "./agent-test-prefetch.service.ts";
import { ConnectedTargetService } from "./connected-target.service.ts";
import type { ScenarioExecutionPrefetchConfig } from "./scenario-execution-prefetcher.service.ts";
import { ScenarioModelParametersService } from "./scenario-model-parameters.service.ts";
import { ScenarioRunKeyService } from "./scenario-run-key.service.ts";
import { ScenarioTargetPrefetchService } from "./scenario-target-prefetch.service.ts";
import { ScenarioWorkflowHydratorService } from "./scenario-workflow-hydrator.service.ts";

export type AgentTestServiceOptions = {
  agents: AgentApi;
  projects: ProjectApi;
  /** Mints the run key the test's child calls LangWatch with. */
  apiKeys: Pick<ApiKeyApi, "mintRunKey">;
  workflows: WorkflowApi;
  prompts: PromptApi;
  secrets: SecretApi;
  modelProviders: ModelProviderApi;
  simulations: SimulationService;
  config: ScenarioExecutionPrefetchConfig;
  /** Runs a turn in a fresh scenario child, where the agent's adapter is built and called. */
  turns: AgentTestTurnChild;
  /** The operator's nlpgo deadlines a code or workflow agent's turn answers inside. */
  nlpTimeouts: AgentTestTurnJob["nlpTimeouts"];
  /** The platform's call-budget ceiling every kind of agent answers inside. */
  maxCallTimeoutMs: number;
};

/** The deadlines the child can carry: JSON has no NaN, and an unset one takes the default there. */
function usableTimeouts({
  engineCodeBlockTimeoutSeconds,
  maxTimeoutMs,
}: AgentTestTurnJob["nlpTimeouts"]): AgentTestTurnJob["nlpTimeouts"] {
  return {
    ...(Number.isFinite(engineCodeBlockTimeoutSeconds) ? { engineCodeBlockTimeoutSeconds } : {}),
    ...(Number.isFinite(maxTimeoutMs) ? { maxTimeoutMs } : {}),
  };
}

const NOT_TESTABLE_REASON = "Only HTTP, code, workflow and connected agents can be tested this way";

const connectedCallConfigSchema = z.looseObject({
  timeoutMs: z.number().int().positive().optional(),
  sticky: z.boolean().optional(),
  parameters: z.unknown().optional(),
});

/** The targets a test RUN can queue: every kind a scenario runs against but a prompt. */
type QueueableTarget = TargetConfig & { type: "http" | "code" | "workflow" | "connected" };

export class AgentTestService {
  static create(options: AgentTestServiceOptions): AgentTestService {
    const modelParameters = ScenarioModelParametersService.create(options.modelProviders);
    const workflowHydrator = ScenarioWorkflowHydratorService.create(modelParameters);
    const targetPrefetch = ScenarioTargetPrefetchService.create({
      prompts: options.prompts,
      agents: options.agents,
      workflows: options.workflows,
      secrets: options.secrets,
      workflowHydrator,
      legacyDefaultModel: options.config.legacyDefaultModel,
      langwatchEndpoint: options.config.langwatchEndpoint,
      voiceTargets: null,
    });

    return new AgentTestService(
      options,
      targetPrefetch,
      ConnectedTargetService.create(options.agents),
      ScenarioRunKeyService.create({ apiKeys: options.apiKeys }),
    );
  }

  private constructor(
    private readonly options: AgentTestServiceOptions,
    private readonly targetPrefetch: ScenarioTargetPrefetchService,
    private readonly connectedTargets: ConnectedTargetService,
    private readonly runKeys: ScenarioRunKeyService,
  ) {}

  /** The target a test points at, with a connected agent's ownership already
   * settled, or the refusal an agent no test can run against carries. */
  private async resolveTarget(input: {
    agent: AgentWithFields;
    projectId: string;
    actor: RunActor | undefined;
  }): Promise<TargetConfig> {
    const target = mapAgentTestTarget(input.agent);
    if (!target) {
      throw new AgentTestRefusedError({ reason: NOT_TESTABLE_REASON });
    }

    const ownerUserId = input.agent.ownerUserId;
    if (target.type !== "connected" || !ownerUserId) {
      return target;
    }

    const { selectable } = connectedAgentSelectability({
      ownerUserId,
      viewerUserId: input.actor?.id,
    });
    if (selectable) {
      return target;
    }

    const owners = await this.options.agents.ownersOf([{ ownerUserId }]);
    throw new AgentOwnerOnlyError({
      agentId: input.agent.id,
      agentName: input.agent.name,
      ownerUserId,
      ownerName: owners.get(ownerUserId)?.name ?? null,
    });
  }

  private async readProject(projectId: string): Promise<ProjectRead> {
    const project = await this.options.projects.findById(projectId);
    if (!project) {
      return { success: false, error: `Project ${projectId} was not found` };
    }

    return { success: true, data: { organizationId: null } };
  }

  private async readAdapter(input: {
    projectId: string;
    target: TargetConfig;
  }): Promise<AdapterRead> {
    const result = await this.targetPrefetch
      .getTargetAdapter({ projectId: input.projectId, target: input.target, runSecretValues: {} })
      .catch((error: unknown) => {
        if (HandledError.isHandled(error) && error.code === "scenario_target_not_found") {
          return null;
        }

        throw error;
      });
    if (result === null) {
      return null;
    }

    if ("success" in result) {
      return { success: false, reason: result.reason, message: result.message };
    }

    return result;
  }

  async sendTurn(input: TestAgentTurnInput): Promise<AgentTestTurnResult> {
    const target = await this.resolveTarget(input);

    if (target.type === "connected") {
      return this.#sendConnectedTurn(input);
    }

    const prefetch = await AgentTestPrefetchService.create().prefetch({
      context: {
        projectId: input.projectId,
        scenarioId: AGENT_TEST_SCENARIO_ID,
        setId: getAgentTestSetId(input.projectId),
        batchRunId: "agent-test-turn",
      },
      target,
      reads: {
        project: () => this.readProject(input.projectId),
        adapter: () => this.readAdapter({ projectId: input.projectId, target }),
        agentName: () => Promise.resolve(input.agent.name),
        runKey: (adapter) =>
          this.runKeys.tokenFor({
            projectId: input.projectId,
            adapter,
            startedByUserId: input.actor?.id,
            startedByApiKeyId: input.actor?.apiKeyId,
          }),
      },
      config: this.options.config,
    });
    if (!prefetch.success) {
      throw new AgentTestRefusedError({ reason: prefetch.error });
    }

    const answer = await this.options.turns.run({
      job: {
        kind: "agent-test-turn",
        adapterData: prefetch.data.adapterData,
        nlpServiceUrl: prefetch.data.nlpServiceUrl,
        parameters: input.params ?? {},
        message: input.message,
        timeoutMs: this.options.maxCallTimeoutMs,
        nlpTimeouts: usableTimeouts(this.options.nlpTimeouts),
      },
      environment: { labels: prefetch.data.scenario.labels, telemetry: prefetch.telemetry },
      logContext: { projectId: input.projectId, scenarioId: AGENT_TEST_SCENARIO_ID },
    });
    if (answer.success) {
      return { output: answer.output, durationMs: answer.durationMs, instance: null };
    }
    if (answer.timeoutMs !== undefined) {
      throw new AgentCallTimeoutError({ timeoutMs: answer.timeoutMs });
    }

    throw new Error(answer.error);
  }

  async #sendConnectedTurn(input: TestAgentTurnInput): Promise<AgentTestTurnResult> {
    const config = connectedCallConfigSchema.parse(input.agent.config ?? {});
    await resolveRunParameters({
      scenarios: [],
      targetDefinitions: parseScenarioParameterDefinitions(config.parameters),
      targetLabel: input.agent.name,
      values: input.params,
    });
    const messages = [{ role: "user" as const, content: input.message }];
    const dispatched = await this.options.agents.callConnected({
      projectId: input.projectId,
      agent: {
        id: input.agent.id,
        name: input.agent.name,
        environment: input.agent.environment ?? null,
        timeoutMs: Math.min(config.timeoutMs ?? DEFAULT_CALL_TIMEOUT_MS, MAX_CALL_TIMEOUT_MS),
        isSticky: config.sticky ?? false,
      },
      call: {
        threadId: generate("scenario").toString(),
        messages,
        newMessages: messages,
        params: input.params ?? {},
        session: void 0,
        traceparent: null,
        run: {},
      },
    });

    return {
      output: dispatched.output,
      durationMs: dispatched.durationMs,
      instance: { hostname: dispatched.instance.hostname, label: dispatched.instance.label },
    };
  }

  async scheduleRun(input: TestAgentRunInput): Promise<AgentTestRunResult> {
    const target = await this.connectedTargets.resolve({
      projectId: input.projectId,
      target: await this.resolveTarget(input),
      actorId: input.actor?.id,
    });

    // `mapAgentTestTarget` never answers "prompt", so what remains is what a run can queue.
    const queueableTarget = target as QueueableTarget;

    const batchRunId = generateBatchRunId();
    const setId = getAgentTestSetId(input.projectId);

    const prefetch = await AgentTestPrefetchService.create().prefetch({
      context: {
        projectId: input.projectId,
        scenarioId: AGENT_TEST_SCENARIO_ID,
        setId,
        batchRunId,
      },
      target: queueableTarget,
      reads: {
        project: () => this.readProject(input.projectId),
        adapter: () => this.readAdapter({ projectId: input.projectId, target: queueableTarget }),
        agentName: () => Promise.resolve(input.agent.name),
        runKey: (adapter) =>
          this.runKeys.tokenFor({
            projectId: input.projectId,
            adapter,
            startedByUserId: input.actor?.id,
            startedByApiKeyId: input.actor?.apiKeyId,
          }),
      },
      config: this.options.config,
    });
    if (!prefetch.success) {
      throw new AgentTestRefusedError({ reason: prefetch.error });
    }

    const scenario = agentTestScenarioConfig({ agentName: input.agent.name });
    const scenarioRunId = generateScenarioRunId();
    await this.options.simulations.queueRun({
      tenantId: input.projectId,
      scenarioRunId,
      scenarioId: AGENT_TEST_SCENARIO_ID,
      batchRunId,
      scenarioSetId: setId,
      name: scenario.name,
      description: scenario.situation,
      metadata: {
        langwatch: {
          targetReferenceId: queueableTarget.referenceId,
          targetType: queueableTarget.type,
          agentTest: true,
          ...withActor(input.actor),
        },
      },
      target: { type: queueableTarget.type, referenceId: queueableTarget.referenceId },
      occurredAt: nowInstant().epochMilliseconds,
    });

    return { scenarioRunId, batchRunId, setId };
  }
}
