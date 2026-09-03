/**
 * "Test agent": one turn sent through the same adapter a simulation turn
 * uses (or, for a connected agent, through the same live dispatcher a
 * simulation's connected column uses), and one scripted run queued through
 * the same execution path, with nothing saved.
 *
 * A connected agent's TEST RUN is refused rather than queued: the queued-run
 * wire schema this service writes to (`SimulationQueueRun.target`) does not
 * accept a `connected` target yet, so nothing here could prepare the child
 * job even if it tried. That is a named absence — `agent_test_refused` with a
 * customer-safe reason — never a stub that pretends to queue something the
 * worker could not run. A connected TURN dispatches for real, through
 * {@link AgentTestConnectedDispatchPort}; with no live instance registered it
 * answers `agent_offline`, the same way the runtime answers everywhere else
 * until the connected-agents transport (`connect.gateway`, long-poll) is
 * restored.
 *
 * @see specs/agents/agent-test-run.feature
 */
import { AgentCallTimeoutError, AgentTestRefusedError } from "@langwatch/agent-contract";
import type { AgentService, AgentWithFields } from "@langwatch/agent-contract";
import type { ModelProviderService } from "@langwatch/model-provider-contract";
import type { ProjectService } from "@langwatch/project-contract";
import type { PromptService } from "@langwatch/prompt-contract";
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
} from "@langwatch/scenario-contract";
import type { SecretService } from "@langwatch/secret-contract";
import type { WorkflowService } from "@langwatch/workflow-contract";

import { createAdapter } from "../adapters/serialized-agent-registry.adapter";
import type { AgentTestConnectedDispatchPort } from "../ports/agent-test-connected-dispatch.port";
import type { AgentTestOwnershipPort } from "../ports/agent-test-ownership.port";
import {
  prefetchAgentTestData,
  type AdapterRead,
  type ProjectRead,
} from "./agent-test-prefetch.service";
import type { ScenarioExecutionPrefetchConfig } from "./scenario-execution-prefetcher.service";
import { ScenarioModelParametersService } from "./scenario-model-parameters.service";
import { ScenarioTargetPrefetchService } from "./scenario-target-prefetch.service";
import { ScenarioWorkflowHydratorService } from "./scenario-workflow-hydrator.service";

/** What one turn answered. */
export type AgentTestTurnResult = {
  output: unknown;
  durationMs: number;
  instance: { hostname: string; label: string | null } | null;
};

/** The ids a scheduled test run answers with. */
export type AgentTestRunResult = {
  scenarioRunId: string;
  batchRunId: string;
  setId: string;
};

export type AgentTestServiceOptions = {
  agents: AgentService;
  projects: ProjectService;
  workflows: WorkflowService;
  prompts: PromptService;
  secrets: SecretService;
  modelProviders: ModelProviderService;
  simulations: SimulationService;
  config: ScenarioExecutionPrefetchConfig;
  ownership: AgentTestOwnershipPort;
  connectedDispatch: AgentTestConnectedDispatchPort;
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
    if (timer) clearTimeout(timer);
  }
}

const NOT_TESTABLE_REASON = "Only HTTP, code, workflow and connected agents can be tested this way";
const CONNECTED_RUN_NOT_QUEUEABLE_REASON =
  "Testing a connected agent through a scripted run is not available on this deployment yet";

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
    await this.options.ownership.assertRunnable({
      agents: [
        {
          id: input.agent.id,
          name: input.agent.name,
          type: input.agent.type,
          ownerUserId: input.agent.ownerUserId ?? null,
        },
      ],
      actor: input.actor,
    });
    return target;
  }

  private async readProject(projectId: string): Promise<ProjectRead> {
    const project = await this.options.projects.tryGetById(projectId);
    if (!project) {
      return { success: false, error: `Project ${projectId} was not found` };
    }
    return { success: true, data: { apiKey: project.apiKey, organizationId: null } };
  }

  private async readAdapter(input: { projectId: string; target: TargetConfig }): Promise<AdapterRead> {
    const result = await this.targetPrefetch.tryFetch({
      projectId: input.projectId,
      target: input.target,
      runSecretValues: {},
    });
    if (result === null) return null;
    if ("success" in result) {
      return { success: false, reason: result.reason, message: result.message };
    }
    return result;
  }

  async sendTurn(input: {
    projectId: string;
    agent: AgentWithFields;
    message: string;
    params?: Record<string, string | number | boolean>;
    actor: RunActor | undefined;
  }): Promise<AgentTestTurnResult> {
    const target = await this.resolveTarget(input);

    if (target.type === "connected") {
      const dispatched = await this.options.connectedDispatch.dispatch({
        projectId: input.projectId,
        agentId: input.agent.id,
        agentName: input.agent.name,
        environment: input.agent.environment ?? null,
        config: input.agent.config,
        message: input.message,
        params: input.params,
      });
      return dispatched;
    }

    const prefetch = await prefetchAgentTestData({
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

    const adapter = createAdapter({
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

  async scheduleRun(input: {
    projectId: string;
    agent: AgentWithFields;
    actor: RunActor | undefined;
  }): Promise<AgentTestRunResult> {
    const target = await this.resolveTarget(input);
    if (target.type === "connected") {
      throw new AgentTestRefusedError({ reason: CONNECTED_RUN_NOT_QUEUEABLE_REASON });
    }
    // `agentTestTarget` never answers "prompt"; only "connected" was excluded
    // above, so what remains is exactly what a run can queue.
    const queueableTarget = target as QueueableTarget;

    const batchRunId = generateBatchRunId();
    const setId = getAgentTestSetId(input.projectId);

    const prefetch = await prefetchAgentTestData({
      context: { projectId: input.projectId, scenarioId: AGENT_TEST_SCENARIO_ID, setId, batchRunId },
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
