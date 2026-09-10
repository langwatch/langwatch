import type { ClickHouseClient } from "@clickhouse/client";
import { AgentApi, MAX_CALL_TIMEOUT_MS } from "@langwatch/agent-contract";
import { BroadcastAdapter } from "@langwatch/presence-server";
import { createApp, LocalFeatureApis, type ResourceScope } from "@langwatch/runtime-composition";
import { ScenarioApi, type SimulationService } from "@langwatch/scenario-contract";
import {
  AgentTestService,
  RedisScenarioTabStoreAdapter,
  ResultAtomsClickHouseAdapter,
  RunConfigurationsClickHouseAdapter,
  scenarioServer,
  ScenarioTabRegistryService,
  SerializedAgentRegistryAdapter,
  type ScenarioExecutionPoolService,
} from "@langwatch/scenario-server";
import { nowInstant, toDate } from "@langwatch/time";
import type { TraceApi } from "@langwatch/trace-contract";
import { UserApi } from "@langwatch/user-contract";
import {
  ModelProviderWorkflowStudioDslAdapter,
  WorkflowAgentMappingAdapter,
  PrismaWorkflowRowAdapter,
  WorkflowApp,
} from "@langwatch/workflow-server";
import { installWorkerAgent } from "./worker-agent.composition.ts";
import { installWorkerEvaluator } from "./worker-evaluator.composition.ts";
import type { WorkerFoundationApps } from "./worker-foundation-apps.composition.ts";
import {
  createWorkerScenarioExecution,
  createWorkerScenarioExecutionGraph,
  type WorkerScenarioExecutionPrerequisites,
} from "./worker-scenario-execution.composition.ts";

/** One Agent App and the actual Scenario/Workflow graphs its operations depend on. */
export async function createWorkerAgentApps(options: {
  prerequisites: WorkerScenarioExecutionPrerequisites;
  foundation: WorkerFoundationApps;
  simulations: SimulationService;
  pool: ScenarioExecutionPoolService;
  resolveClickHouseClient(projectId: string): Promise<ClickHouseClient>;
  resources: ResourceScope;
  traces: TraceApi;
}) {
  const { prerequisites, foundation, resources, simulations } = options;
  const publicBaseUrl = prerequisites.config.infrastructure.execution.publicBaseUrl;
  if (!publicBaseUrl) throw new Error("Worker Agent installation requires the public base URL.");
  const database = prerequisites.connection.client;
  const peers = new LocalFeatureApis();
  peers.declare(AgentApi);
  peers.declare(ScenarioApi);
  const agents = peers.reference(AgentApi);
  const scenarioApi = peers.reference(ScenarioApi);
  resources.own("worker agent peer clients", () => peers.close());

  const graph = await createWorkerScenarioExecutionGraph({
    prerequisites,
    simulations,
    agents,
    scenarioApi,
    traces: options.traces,
    resources,
  });
  const execution = createWorkerScenarioExecution({
    prerequisites,
    simulations,
    agents,
    graph,
    pool: options.pool,
  });
  const broadcast = BroadcastAdapter.create(prerequisites.redis);
  resources.own("worker scenario broadcasts", () => broadcast.close());
  const config = {
    langwatchEndpoint: prerequisites.langwatchEndpoint,
    nlpServiceUrl: prerequisites.nlpServiceUrl,
    legacyDefaultModel: prerequisites.config.infrastructure.execution.defaultModel,
  };
  const scenarioRuntime = await createApp({ name: "langwatch-worker-scenario" })
    .withPersistence("postgres", { prisma: database })
    .withInfrastructure({})
    .withProvided(UserApi, foundation.users)
    .withModule(scenarioServer, {
      infrastructure: {
        ...graph.scenarioPorts,
        simulations,
        scenarioExecution: execution.execution,
        agentTesting: AgentTestService.create({
          agents,
          projects: foundation.tenancy.projects,
          workflows: graph.workflows,
          prompts: graph.prompts,
          secrets: graph.secrets,
          modelProviders: prerequisites.modelProviders,
          simulations,
          config,
          agentAdapters: SerializedAgentRegistryAdapter.create(),
          maxCallTimeoutMs: MAX_CALL_TIMEOUT_MS,
        }),
        scenarioTabs: ScenarioTabRegistryService.create({
          store: RedisScenarioTabStoreAdapter.create(prerequisites.redis),
          clock: { now: () => toDate(nowInstant()) },
        }),
        broadcast,
        resultAtoms: ResultAtomsClickHouseAdapter.create({
          prisma: database,
          resolveClient: options.resolveClickHouseClient,
        }),
        runConfigurations: RunConfigurationsClickHouseAdapter.create({
          prisma: database,
          resolveClient: options.resolveClickHouseClient,
        }),
      },
    })
    .boot({ role: "worker" });
  resources.own("worker scenario module", () => scenarioRuntime.stop());
  const scenarios = scenarioRuntime.module(scenarioServer).provided;
  const evaluators = await installWorkerEvaluator({
    database,
    permissions: foundation.tenancy.authorization,
    auditLog: foundation.auditLog,
    users: foundation.users,
    workflows: graph.workflows,
    nlpRuntime: graph.nlpRuntime,
    modelProviders: prerequisites.modelProviders,
    resources,
    name: "worker agent evaluator application",
  });
  const workflows = WorkflowApp.create({
    infrastructure: {
      workflows: graph.workflows,
      datasets: graph.datasets,
      evaluators,
      studioDsl: ModelProviderWorkflowStudioDslAdapter.create({
        modelProviders: prerequisites.modelProviders,
      }),
      agentMappings: WorkflowAgentMappingAdapter.create({ agents }),
      workflowRows: PrismaWorkflowRowAdapter.create({ database }),
    },
    dependencies: {},
    config: void 0,
    resources,
  });
  const agent = await installWorkerAgent({
    connection: prerequisites.connection,
    infrastructure: { redis: prerequisites.redis },
    config: {
      publicBaseUrl,
      connected: prerequisites.config.infrastructure.connectedAgents,
    },
    peers: {
      apiKeys: foundation.tenancy.apiKeys,
      auditLog: foundation.auditLog,
      permissions: foundation.tenancy.authorization,
      projects: foundation.tenancy.projects,
      users: foundation.users,
      scenarios,
      traces: options.traces,
      workflows,
    },
  });
  resources.own("worker agent runtime", () => agent.runtime.stop());
  peers.bind(AgentApi, agent.agents);
  peers.bind(ScenarioApi, scenarios);
  peers.ready();

  return {
    processor: execution.processor,
    async start() {
      await broadcast.start();
      await agent.runtime.start();
    },
  };
}
