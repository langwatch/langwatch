/**
 * The order in which the worker mounts its feature installers.
 *
 * It is not incidental. The live `PipelineRegistry` registers Automation
 * first because every trigger match in the trace, evaluation and governance
 * graphs is written through its command; Metric and Log before Trace because
 * their dispatch subscribers feed the same contribution commands; Trace before
 * Topic because Topic dispatches assignments through Trace's canonical
 * assignment port; and the AuthZ grants ledger last, so its durable write path
 * opens only once every producer exists. Reordering any of those silently
 * gives a late-bound port a caller before it has a delegate.
 *
 * The composition is also allowed to be INCOMPLETE while the remaining Wave 4
 * pipeline groups are still owned by the legacy registry, so this pins the
 * relative order of what is present rather than a fixed list.
 */
import {
  InMemoryProcessStore,
  type EventSourcedQueueProcessor,
  type EventSourcing,
} from "@langwatch/eventing";
import type { ProcessRetentionMetricsPort, RetentionFamily } from "@langwatch/eventing/server";
import { EventStoreMemory } from "@langwatch/eventing/testing";
import { TraceTopicAssignmentPort, type AssignTopicCommandData } from "@langwatch/trace-contract";
import { describe, expect, it, vi } from "vitest";
import { WorkerProductionComposition } from "../worker-production.composition";
import { ApiKeyWorkerFeatureInstaller } from "../../features/api-key/api-key-worker-feature.installer";
import { AuthzWorkerFeatureInstaller } from "../../features/authz/authz-worker-feature.installer";
import { AutomationWorkerFeatureInstaller } from "../../features/automation/automation-worker-feature.installer";
import { BillingReportingWorkerFeatureInstaller } from "../../features/billing/billing-reporting-worker-feature.installer";
import { CodingAgentWorkerFeatureInstaller } from "../../features/coding-agent/coding-agent-worker-feature.installer";
import { EvaluationWorkerFeatureInstaller } from "../../features/evaluation/evaluation-worker-feature.installer";
import {
  EventingMaintenanceWorkerFeatureInstaller,
  WorkerBlobSweepPort,
} from "../../features/eventing-maintenance/eventing-maintenance-worker-feature.installer";
import { ExperimentWorkerFeatureInstaller } from "../../features/experiment/experiment-worker-feature.installer";
import { GatewaySpendWorkerFeatureInstaller } from "../../features/gateway/gateway-spend-worker-feature.installer";
import { GithubWorkerFeatureInstaller } from "../../features/github/github-worker-feature.installer";
import { GovernanceEventsWorkerFeatureInstaller } from "../../features/governance/governance-events-worker-feature.installer";
import { GovernanceIngestionWorkerFeatureInstaller } from "../../features/governance/governance-ingestion-worker-feature.installer";
import { IdentityWorkerFeatureInstaller } from "../../features/identity/identity-worker-feature.installer";
import { JoinRequestWorkerFeatureInstaller } from "../../features/identity/join-request-worker-feature.installer";
import { ScimSyncWorkerFeatureInstaller } from "../../features/identity/scim-sync-worker-feature.installer";
import { SsoConnectionWorkerFeatureInstaller } from "../../features/identity/sso-connection-worker-feature.installer";
import { LogWorkerFeatureInstaller } from "../../features/log/log-worker-feature.installer";
import { MetricWorkerFeatureInstaller } from "../../features/metric/metric-worker-feature.installer";
import { ScenarioWorkerFeatureInstaller } from "../../features/scenario/scenario-worker-feature.installer";
import { SuiteWorkerFeatureInstaller } from "../../features/suite/suite-worker-feature.installer";
import {
  TopicWorkerFeatureInstaller,
  type TopicWorkerCapability,
} from "../../features/topic/topic-worker-feature.installer";
import { TraceWorkerFeatureInstaller } from "../../features/trace/trace-worker-feature.installer";
import { resolveWorkerConfig } from "../../platform/config/worker.config";
import { WorkerEventingRuntime } from "../../platform/eventing/worker-eventing.runtime";
import {
  WorkerHandlePort,
  WorkerLifecyclePort,
  WorkerTransportPort,
} from "../../platform/lifecycle/worker-runtime.port";

class Queue implements EventSourcedQueueProcessor<Record<string, unknown>> {
  readonly send = vi.fn(async () => undefined);
  readonly sendBatch = vi.fn(async () => undefined);
  readonly close = vi.fn(async () => undefined);
  readonly waitUntilReady = vi.fn(async () => undefined);
}

class Handle extends WorkerHandlePort {
  readonly shutdown = vi.fn(async () => undefined);
}

class Transport extends WorkerTransportPort {
  readonly handle = new Handle();
  readonly start = vi.fn(async () => this.handle);
}

class Lifecycle extends WorkerLifecyclePort {
  readonly close = vi.fn(async () => undefined);
}

class TraceAssignments extends TraceTopicAssignmentPort {
  readonly assignTopic = vi.fn(async (_input: AssignTopicCommandData) => undefined);
}

class TopicCapability implements TopicWorkerCapability {
  readonly install = vi.fn(({ eventSourcing }: { eventSourcing: EventSourcing }) =>
    eventSourcing.register(namedDefinition("topic_clustering")),
  );
  readonly startBootSeeds = vi.fn();
  readonly commandDispatch = {
    recordTopics: vi.fn(async () => undefined),
    requestClustering: vi.fn(async () => undefined),
  };
}

class BlobSweep extends WorkerBlobSweepPort {
  readonly sweep = vi.fn(async () => ({
    queues: [],
    totals: {
      scanned: 0,
      truncated: false,
      leased: 0,
      repaired: 0,
      reclaimed: 0,
      bookkeeping: 0,
      pending: 0,
    },
    dryRun: false,
    durationMs: 1,
  }));
}

class RetentionMetrics implements ProcessRetentionMetricsPort {
  recordSweptRows(_family: RetentionFamily, _rows: number): void {}
  recordFailure(_family: RetentionFamily): void {}
}

/** A definition stand-in carrying only what the order guard observes. */
function namedDefinition(name: string) {
  return { metadata: { name, aggregateType: "global" } } as never;
}

/** Records the pipeline names registered against the shared Eventing runtime. */
function createEventing(registered: string[]) {
  const eventing = WorkerEventingRuntime.create({
    eventStore: EventStoreMemory.createForTesting(),
    queueFactory: () => new Queue(),
    processStore: InMemoryProcessStore.createForTesting(),
    executionTarget: "worker",
    warnWhenProjectionsRunInline: false,
    consumers: { enabled: false },
  });
  // Registration itself is the eventing package's contract; what this suite
  // observes is which definition reaches it, and in what order.
  //
  // Every installer reads back the command senders it binds its cross-feature
  // proxies to and refuses to install when one is missing, so the stub answers
  // with the union of those names rather than a bare object: a registration
  // that returned nothing would fail the guard for a reason this suite is not
  // asking about.
  const commands = Object.fromEntries(
    [
      "recordTriggerMatch",
      "executeEvaluation",
      "reportEvaluation",
      "contributeSpanFacts",
      "contributeMetricFacts",
      "contributeLogFacts",
      "recordVkLifecycle",
      "recordBudgetCrossing",
      "settleSpend",
      "recordSuiteRunItemStarted",
      "completeSuiteRunItem",
      "computeRunMetrics",
      "computeExperimentRunMetrics",
      "reportUsageForMonth",
      // AuthZ's six. They were absent while its installer asserted over the
      // command map instead of checking it, so the double claimed a
      // registration that produced nothing.
      "attachGrant",
      "changeGrantRole",
      "revokeGrant",
      "defineRole",
      "changeRolePermissions",
      "deleteRole",
    ].map((name) => [name, { send: async () => undefined }]),
  );
  vi.spyOn(eventing.eventSourcing, "register").mockImplementation((definition) => {
    registered.push(definition.metadata.name);
    return {
      commands,
      service: {
        registerJob: () => ({ send: async () => undefined }),
      },
    } as never;
  });
  return eventing;
}

/** Scenario's package-owned retry spec, reduced to what the installer reads. */
const scenarioDeferredMetricsJob = {
  name: "deferredComputeRunMetrics",
  delayMs: 1_000,
  makeJobId: () => "retry",
  spanAttributes: () => ({}),
};

function createComposition(registered: string[]) {
  const eventing = createEventing(registered);
  const traceAssignments = new TraceAssignments();
  const trace = TraceWorkerFeatureInstaller.create({
    installer: {
      install: vi.fn((eventSourcing: EventSourcing) => {
        eventSourcing.register(namedDefinition("trace_processing"));
        return { traceAssignments };
      }),
    },
    eventing,
  });
  const topic = TopicWorkerFeatureInstaller.create({
    installer: new TopicCapability(),
    eventing,
    traceAssignments: trace.traceAssignments,
  });
  return WorkerProductionComposition.createFromPorts({
    config: resolveWorkerConfig({ NODE_ENV: "test" }),
    eventing,
    lifecycle: new Lifecycle(),
    transport: new Transport(),
    automation: AutomationWorkerFeatureInstaller.create({
      installer: { buildPipeline: () => namedDefinition("automations") },
      eventing,
    }),
    eventingMaintenance: EventingMaintenanceWorkerFeatureInstaller.create({
      eventing,
      blobSweep: new BlobSweep(),
      retentionMetrics: new RetentionMetrics(),
    }),
    // The real pipeline, because the API-key feature composes its own now: the
    // name this asserts on comes from `@langwatch/api-key-server` rather than
    // from a stub this file spelled.
    apiKey: ApiKeyWorkerFeatureInstaller.create({
      eventing,
      sandboxKeyReap: { reap: async () => 0 },
    }),
    github: GithubWorkerFeatureInstaller.create({
      installer: { buildMaintenance: () => namedDefinition("github_maintenance") },
      eventing,
    }),
    evaluation: EvaluationWorkerFeatureInstaller.create({
      installer: { buildProcessing: () => namedDefinition("evaluation_processing") },
      eventing,
    }),
    codingAgent: CodingAgentWorkerFeatureInstaller.create({
      installer: { buildProcessing: () => namedDefinition("coding_agent_processing") },
      eventing,
    }),
    governanceEvents: GovernanceEventsWorkerFeatureInstaller.create({
      installer: { buildProcessing: () => namedDefinition("governance_events") },
      eventing,
    }),
    gatewaySpend: GatewaySpendWorkerFeatureInstaller.create({
      installer: {
        buildProcessing: () => namedDefinition("gateway_spend"),
        connectSettlement: vi.fn(),
      },
      eventing,
    }),
    metric: MetricWorkerFeatureInstaller.create({
      installer: { buildProcessing: () => namedDefinition("metric_processing") },
      eventing,
    }),
    log: LogWorkerFeatureInstaller.create({
      installer: { buildProcessing: () => namedDefinition("log_processing") },
      eventing,
    }),
    trace,
    suite: SuiteWorkerFeatureInstaller.create({
      installer: { buildProcessing: () => namedDefinition("suite_run_processing") },
      eventing,
    }),
    scenario: ScenarioWorkerFeatureInstaller.create({
      installer: {
        buildProcessing: () => namedDefinition("simulation_processing"),
        deferredComputeRunMetricsJob: scenarioDeferredMetricsJob,
        connect: vi.fn(),
      },
      eventing,
    }),
    experiment: ExperimentWorkerFeatureInstaller.create({
      installer: { buildProcessing: () => namedDefinition("experiment_run_processing") },
      eventing,
    }),
    topic,
    governanceIngestion: GovernanceIngestionWorkerFeatureInstaller.create({
      installer: {
        register: (eventSourcing) => {
          const pulledUsage = eventSourcing.register(namedDefinition("pulled_usage"));
          const ingestionPull = eventSourcing.register(namedDefinition("ingestion_pull"));
          return { pulledUsage, ingestionPull, lifecycle: {} };
        },
      },
      eventing,
    }),
    billingReporting: BillingReportingWorkerFeatureInstaller.create({
      installer: {
        buildProcessing: () => namedDefinition("billing_reporting"),
        connectSelfDispatch: vi.fn(),
      },
      eventing,
    }),
    authz: AuthzWorkerFeatureInstaller.create({
      installer: {
        pipeline: namedDefinition("authz_grants"),
        connect: vi.fn(),
      },
      eventing,
    }),
    identity: IdentityWorkerFeatureInstaller.create({
      installer: { pipeline: namedDefinition("identity") },
      eventing,
    }),
    ssoConnection: SsoConnectionWorkerFeatureInstaller.create({
      installer: { pipeline: namedDefinition("sso_connections") },
      eventing,
    }),
    scimSync: ScimSyncWorkerFeatureInstaller.create({
      installer: { pipeline: namedDefinition("scim_sync") },
      eventing,
    }),
    joinRequest: JoinRequestWorkerFeatureInstaller.create({
      installer: { pipeline: namedDefinition("join_requests") },
      eventing,
    }),
  });
}

describe("worker feature registration order", () => {
  describe("given every migrated pipeline group is composed", () => {
    describe("when the worker application starts", () => {
      it("mounts the installers in the order the live registry uses", async () => {
        const registered: string[] = [];
        const composition = createComposition(registered);

        await composition.application.start();

        expect(composition.featureInstallers.map((installer) => installer.name)).toEqual([
          "automation",
          "eventing-maintenance",
          "api-key",
          "github",
          "evaluation",
          "coding-agent",
          "governance-events",
          "gateway-spend",
          "metric",
          "log",
          "trace",
          "suite",
          "scenario",
          "experiment",
          "topic",
          "governance-ingestion",
          "billing-reporting",
          "authz",
          "identity",
          "sso-connection",
          "scim-sync",
          "join-request",
        ]);
      });

      it("registers Automation first and the AuthZ grants ledger last", async () => {
        const registered: string[] = [];
        const composition = createComposition(registered);

        await composition.application.start();

        expect(registered[0]).toBe("automations");
        // AuthZ is the last of the shared-graph producers; the four identity
        // ledgers mount after it, in the legacy registry's order.
        expect(registered.slice(-5)).toEqual([
          "authz_grants",
          "identity",
          "sso_connections",
          "scim_sync",
          "join_requests",
        ]);
        // The substrate's own sweeps mount together, blob before retention,
        // exactly as the live registry mounts them.
        expect(registered.slice(1, 3)).toEqual(["blob_maintenance", "process_manager_maintenance"]);
        // Metric and Log precede Trace; Trace precedes Topic.
        expect(registered.indexOf("metric_processing")).toBeLessThan(
          registered.indexOf("log_processing"),
        );
        expect(registered.indexOf("log_processing")).toBeLessThan(
          registered.indexOf("trace_processing"),
        );
        // Governance events and Gateway spend mount as one adjacent pair, the
        // way the live registry mounts them under a single guard. Spend's
        // debit adapter delivers through Governance's commands, so a graph
        // that carried one without the other would drop every debit.
        expect(registered.indexOf("gateway_spend")).toBe(
          registered.indexOf("governance_events") + 1,
        );
        // Suite precedes Scenario, whose process manager reports item starts
        // and completions into it.
        expect(registered.indexOf("suite_run_processing")).toBeLessThan(
          registered.indexOf("simulation_processing"),
        );
      });

      it("completes every registration before queue readiness is awaited", async () => {
        const registered: string[] = [];
        const composition = createComposition(registered);
        const start = vi.spyOn(composition.eventing, "start");

        await composition.application.start();

        expect(start).toHaveBeenCalledOnce();
        expect(registered).toEqual([
          "automations",
          "blob_maintenance",
          "process_manager_maintenance",
          "agent_sandbox_maintenance",
          "github_maintenance",
          "evaluation_processing",
          "coding_agent_processing",
          "governance_events",
          "gateway_spend",
          "metric_processing",
          "log_processing",
          "trace_processing",
          "suite_run_processing",
          "simulation_processing",
          "experiment_run_processing",
          "topic_clustering",
          // Governance ingestion registers two definitions, pulled usage
          // first: the ingestion-pull run port dispatches its observations.
          "pulled_usage",
          "ingestion_pull",
          "billing_reporting",
          "authz_grants",
          "identity",
          "sso_connections",
          "scim_sync",
          "join_requests",
        ]);
      });
    });
  });

  describe("given a pipeline group still owned by the legacy registry", () => {
    describe("when the worker composes without it", () => {
      it("keeps the remaining installers in the same relative order", async () => {
        const registered: string[] = [];
        const eventing = createEventing(registered);
        const traceAssignments = new TraceAssignments();
        const trace = TraceWorkerFeatureInstaller.create({
          installer: {
            install: vi.fn((eventSourcing: EventSourcing) => {
              eventSourcing.register(namedDefinition("trace_processing"));
              return { traceAssignments };
            }),
          },
          eventing,
        });
        const topic = TopicWorkerFeatureInstaller.create({
          installer: new TopicCapability(),
          eventing,
          traceAssignments: trace.traceAssignments,
        });
        const composition = WorkerProductionComposition.createFromPorts({
          config: resolveWorkerConfig({ NODE_ENV: "test" }),
          eventing,
          lifecycle: new Lifecycle(),
          transport: new Transport(),
          eventingMaintenance: EventingMaintenanceWorkerFeatureInstaller.create({
            eventing,
            blobSweep: new BlobSweep(),
            retentionMetrics: new RetentionMetrics(),
          }),
          trace,
          topic,
        });

        await composition.application.start();

        expect(composition.featureInstallers.map((installer) => installer.name)).toEqual([
          "eventing-maintenance",
          "trace",
          "topic",
        ]);
      });
    });
  });

  describe("given Automation has not installed yet", () => {
    describe("when a trigger-match producer dispatches", () => {
      it("refuses rather than dropping the match", async () => {
        const registered: string[] = [];
        const eventing = createEventing(registered);
        const automation = AutomationWorkerFeatureInstaller.create({
          installer: { buildPipeline: () => namedDefinition("automations") },
          eventing,
        });

        await expect(
          automation.triggerMatches.send({
            tenantId: "project-1",
            occurredAt: 1,
          } as never),
        ).rejects.toThrow("Automation must install before trigger matches are recorded.");
      });
    });
  });
});
