/**
 * "Test agent": one turn sent through the same adapter a simulation turn uses (or, for a connected
 * agent, through the same live dispatcher a simulation's connected column uses),
 * @see specs/agents/agent-test-run.feature
 */
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
import type { ModelProviderService } from "@langwatch/model-provider-contract";
import type { ProjectApi } from "@langwatch/project-contract";
import type { PromptApi } from "@langwatch/prompt-contract";
import { AgentRole, type AgentInput } from "@langwatch/scenario";
import {
  AGENT_TEST_SCENARIO_ID,
  agentTestScenarioConfig,
  agentTestTarget,
  generateBatchRunId,
  generateScenarioRunId,
  getAgentTestSetId,
  withActor,
  type RunActor,
  type SimulationService,
  type TargetConfig,
  type TestAgentRunInput,
  type TestAgentTurnInput,
} from "@langwatch/scenario-contract";
import type { SecretApi } from "@langwatch/secret-contract";
import type { WorkflowService } from "@langwatch/workflow-contract";

import type { AgentAdapterFactoryPort } from "../ports/agent-adapter-factory.port.ts";
import { z } from "zod";
import {
  AgentTestPrefetchService,
  type AdapterRead,
  type ProjectRead,
} from "./agent-test-prefetch.service.ts";
import type { ScenarioExecutionPrefetchConfig } from "./scenario-execution-prefetcher.service.ts";
import { ScenarioModelParametersService } from "./scenario-model-parameters.service.ts";
import { ScenarioTargetPrefetchService } from "./scenario-target-prefetch.service.ts";
import { ScenarioWorkflowHydratorService } from "./scenario-workflow-hydrator.service.ts";

export type AgentTestServiceOptions = {
  agents: AgentApi;
  projects: ProjectApi;
  workflows: WorkflowService;
  prompts: PromptApi;
  secrets: SecretApi;
  modelProviders: ModelProviderService;
  simulations: SimulationService;
  config: ScenarioExecutionPrefetchConfig;
  /** Builds the adapter that speaks to the agent under test. */
  agentAdapters: AgentAdapterFactoryPort;
  /** The platform's call-budget ceiling every kind of agent answers inside. */
  maxCallTimeoutMs: number;
};

/** The input of a single turn, as the adapters read it. */
function oneTurnInput({ threadId, message }: { threadId: string; message: string }): AgentInput {
  const userMessage = { role: "user" as const, content: message };

  return {
    threadId,
    messages: [userMessage],
    newMessages: [userMessage],
    requestedRole: AgentRole.AGENT,
    scenarioState: {} as AgentInput["scenarioState"],
    scenarioConfig: {} as AgentInput["scenarioConfig"],
  };
}

/** The ceiling every kind of agent answers inside (ADR-128's call-budget
 * cap), so a turn never parks the request for as long as the agent takes. */
async function withinCallDeadline<T>(work: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          void work.catch(() => undefined);
          reject(new AgentCallTimeoutError({ timeoutMs }));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

const NOT_TESTABLE_REASON = "Only HTTP, code, workflow and connected agents can be tested this way";
const CONNECTED_RUN_NOT_QUEUEABLE_REASON =
  "Testing a connected agent through a scripted run is not available on this deployment yet";

const connectedCallConfigSchema = z.looseObject({
  timeoutMs: z.number().int().positive().optional(),
  sticky: z.boolean().optional(),
});

/** The targets a test RUN can queue, once a connected one is refused. */
type QueueableTarget = TargetConfig & { type: "http" | "code" | "workflow" };

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
    });

    return new AgentTestService(options, targetPrefetch);
  }

  private constructor(
    private readonly options: AgentTestServiceOptions,
    private readonly targetPrefetch: ScenarioTargetPrefetchService,
  ) {}

  /** The target a test points at, with a connected agent's ownership already
   * settled, or the refusal an agent no test can run against carries. */
  private async resolveTarget(input: {
    agent: AgentWithFields;
    projectId: string;
    actor: RunActor | undefined;
  }): Promise<TargetConfig> {
    const target = agentTestTarget(input.agent);
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
    const project = await this.options.projects.tryGetById(projectId);
    if (!project) {
      return { success: false, error: `Project ${projectId} was not found` };
    }

    return { success: true, data: { apiKey: project.apiKey, organizationId: null } };
  }

  private async readAdapter(input: {
    projectId: string;
    target: TargetConfig;
  }): Promise<AdapterRead> {
    const result = await this.targetPrefetch.tryFetch({
      projectId: input.projectId,
      target: input.target,
      runSecretValues: {},
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
      },
      config: this.options.config,
    });
    if (!prefetch.success) {
      throw new AgentTestRefusedError({ reason: prefetch.error });
    }

    const adapter = this.options.agentAdapters.build({
      adapterData: prefetch.data.adapterData,
      nlpServiceUrl: prefetch.data.nlpServiceUrl,
      projectApiKey: prefetch.telemetry.apiKey,
      parameters: input.params ?? {},
    });
    const startedAt = Date.now();
    const output = await withinCallDeadline(
      adapter.call(oneTurnInput({ threadId: crypto.randomUUID(), message: input.message })),
      this.options.maxCallTimeoutMs,
    );

    return { output, durationMs: Date.now() - startedAt, instance: null };
  }

  async #sendConnectedTurn(input: TestAgentTurnInput): Promise<AgentTestTurnResult> {
    const config = connectedCallConfigSchema.parse(input.agent.config ?? {});
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
        threadId: crypto.randomUUID(),
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
    const target = await this.resolveTarget(input);
    if (target.type === "connected") {
      throw new AgentTestRefusedError({ reason: CONNECTED_RUN_NOT_QUEUEABLE_REASON });
    }

    // `agentTestTarget` never answers "prompt"; only "connected" was excluded
    // above, so what remains is exactly what a run can queue.
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
      occurredAt: Date.now(),
    });

    return { scenarioRunId, batchRunId, setId };
  }
}
