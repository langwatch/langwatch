import type { ClickHouseClient } from "@clickhouse/client";
import { AgentApi } from "@langwatch/agent-contract";
import { AuditLogApi } from "@langwatch/audit-log-contract";
import { AuthzApi } from "@langwatch/authz-contract";
import { DatasetApi } from "@langwatch/dataset-contract";
import { evaluatorServer } from "@langwatch/evaluator-server";
import { ModelProviderApi } from "@langwatch/model-provider-contract";
import { BroadcastAdapter } from "@langwatch/presence-server";
import {
  createApp,
  LocalFeatureApis,
  membersFrom,
  type ResourceScope,
} from "@langwatch/runtime-composition";
import { ScenarioApi, type SimulationService } from "@langwatch/scenario-contract";
import { scenarioServer, type ScenarioExecutionPoolService } from "@langwatch/scenario-server";
import type { TraceApi } from "@langwatch/trace-contract";
import { UserApi } from "@langwatch/user-contract";
import { workflowServer } from "@langwatch/workflow-server";
import { installWorkerAgent } from "./worker-agent.composition.ts";
import { resolveWorkerStoredSecretCipher } from "./worker-automation-graph.composition.ts";
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
  // The scenario module's App still reads a bespoke infrastructure bag
  // (agentTesting, scenarioTabs, broadcast, resultAtoms, runConfigurations)
  // the v2 builder has no seam for — only `reads("encryption")` and its one
  // peer (UserApi) travel through `createApp`. Closing that gap is the
  // scenario module's own conversion to make, not this composition's.
  const scenarioRuntime = await createApp({
    role: "worker",
    members: membersFrom({
      prisma: database,
      encryption: resolveWorkerStoredSecretCipher(prerequisites.config),
    }),
  })
    .withProvided(UserApi, foundation.users)
    .withModules([scenarioServer])
    .boot();
  resources.own("worker scenario module", () => scenarioRuntime.stop());
  const scenarios = scenarioRuntime.module(scenarioServer).provided;
  // Workflow and evaluator name each other, so they install in ONE app and
  // boot's preallocated API clients resolve the cycle. `agents` is the lazy
  // peer reference declared above - the agent runtime binds it before any
  // call reaches it.
  const studioRuntime = await createApp({
    role: "worker",
    config: {
      evaluator: {},
      workflow: {
        nlpServiceUrl: prerequisites.config.infrastructure.modelProvider.nlpServiceUrl,
      },
    },
    members: membersFrom({
      prisma: database,
      encryption: resolveWorkerStoredSecretCipher(prerequisites.config),
    }),
  })
    .withProvided(AuthzApi, foundation.tenancy.authorization)
    .withProvided(AuditLogApi, foundation.auditLog)
    .withProvided(UserApi, foundation.users)
    .withProvided(ModelProviderApi, prerequisites.modelProviders)
    .withProvided(DatasetApi, graph.datasets)
    .withProvided(AgentApi, agents)
    .withModules([workflowServer, evaluatorServer])
    .boot();
  resources.own("worker studio module runtime", () => studioRuntime.stop());
  const workflows = studioRuntime.module(workflowServer).provided;
  const agent = await installWorkerAgent({
    connection: prerequisites.connection,
    redis: prerequisites.redis,
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
    /** The studio runtime's workflow app, for peers installed later in boot. */
    workflows,
    async start() {
      await broadcast.start();
      await agent.runtime.start();
    },
  };
}
