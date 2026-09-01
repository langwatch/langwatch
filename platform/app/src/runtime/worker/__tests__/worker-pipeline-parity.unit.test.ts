/**
 * Whether the extracted worker's graph and the live legacy registry agree on
 * what they consume from `event-sourcing/jobs`.
 *
 * They are the two halves of an unfinished move. `platform/app`'s
 * `PipelineRegistry` is what runs — `workers.ts` boots `WorkerExecutable` with
 * `LegacyWorkerExecutableComposition`, which builds the legacy app graph — and
 * `apps/worker`'s `WorkerProductionComposition` is where it is going.
 *
 * Nothing compared them, and the switchover cannot be safe until something
 * does: a pipeline that only the legacy side registers would stop being
 * consumed the day the worker composition goes live, and one that only the
 * worker registers would be registered twice while both graphs run. Both are
 * silent failures — the first is work that simply stops happening, and the
 * second is a name collision inside one process.
 *
 * The table below is the reviewable artefact for FEATURE parity. Every legacy
 * registration is mapped to the worker feature that owns it, and both
 * directions are checked, so adding a pipeline to either side without the
 * other fails here.
 *
 * Feature parity is necessary and not sufficient. The one shared queue routes
 * every job by `${pipeline}:${jobType}:${jobName}`, and an unregistered key is
 * not dropped — `EventSourcing.rejectUnroutableJob` throws it back for
 * redelivery, so a consumer missing ONE handler stalls that handler's work
 * forever while looking healthy. The second half of this file therefore builds
 * BOTH registries for real and compares their whole routing-key set against
 * `apps/worker/src/features/job-registry.json`, which is the switch's
 * checklist: it is what the packaged consumer must be able to route before it
 * may claim the queue.
 */
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { EventSourcing, InMemoryProcessStore } from "@langwatch/eventing";
import type { EventSourcingOptions } from "@langwatch/eventing";
import { createEventingRetentionConfiguration } from "@langwatch/eventing/server";
import { EventStoreMemory } from "@langwatch/eventing/testing";
import { LogRuntimeAdapter } from "@langwatch/log-server";
import { MetricRuntimeAdapter } from "@langwatch/metric-server";
import { TopicServerInstaller } from "@langwatch/topic-server";
import { TraceProcessingServerInstaller } from "@langwatch/trace-server";
import { AppGovernanceEventingAdapter } from "@langwatch/enterprise-api/governance/governance-eventing.adapter";
import {
  resolveWorkerConfig,
  WorkerHandlePort,
  WorkerLifecyclePort,
  WorkerProductionComposition,
  WorkerTransportPort,
} from "@langwatch/worker";
import { AuthzFeature } from "~/runtime/app/features/authz";
import {
  PipelineRegistry,
  type PipelineRegistryWorkerCapabilities,
} from "~/server/event-sourcing/registration/pipelineRegistry";
import { createBillingMeterDispatchSubscriber } from "~/server/event-sourcing/registration/global/billingMeterDispatch.subscriber";
import { orgBillableEventsMeterProjection } from "~/server/event-sourcing/registration/global/orgBillableEventsMeter.mapProjection";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "../../../../../..");
const REGISTRY = join(
  REPO_ROOT,
  "platform/app/src/server/event-sourcing/registration/pipelineRegistry.ts",
);
const WORKER_CATALOGUE = join(REPO_ROOT, "apps/worker/src/features/catalogue.json");
const WORKER_JOB_REGISTRY = join(REPO_ROOT, "apps/worker/src/features/job-registry.json");

/**
 * What each legacy `this.registerPipeline(...)` call registers, by the worker
 * feature that owns the same pipeline.
 *
 * Keyed on the expression the registry passes, because that is what a reader
 * of `pipelineRegistry.ts` sees; the pipeline's own name is a constant inside
 * the feature package and never appears at the registration.
 */
const LEGACY_REGISTRATIONS: Readonly<Record<string, string>> = {
  createAutomationsPipeline: "automation",
  createBlobMaintenancePipeline: "eventing-maintenance",
  createProcessManagerMaintenancePipeline: "eventing-maintenance",
  "EventingLangyMaintenanceAdapter.create": "langy-maintenance",
  "EventingAgentSandboxMaintenanceAdapter.create": "api-key",
  "EventingGithubMaintenanceAdapter.create": "github",
  "this.deps.authz.pipeline": "authz",
  createIdentityPipeline: "identity",
  createSsoConnectionPipeline: "sso-connection",
  createScimSyncPipeline: "scim-sync",
  createJoinRequestPipeline: "join-request",
  "langy.buildProcessing": "langy-conversation",
  "this.deps.metricProcessing.buildProcessing": "metric",
  createGovernanceEventsPipeline: "governance-events",
  "spend.buildProcessing": "gateway-spend",
  "EventingCodingAgentProcessingAdapter.create": "coding-agent",
  "this.deps.logProcessing.buildProcessing": "log",
  createEvaluationProcessingPipeline: "evaluation",
  createSuiteRunProcessingPipeline: "suite",
  "SimulationProcessingPipelineAdapter.create": "scenario",
  "billingReporting.buildProcessing": "billing-reporting",
  createExperimentRunProcessingPipeline: "experiment",
};

/**
 * Three features register through an installer of their own rather than
 * through a `this.registerPipeline(...)` the sweep below can see: Trace
 * hands its pipeline to `TraceProcessingServerInstaller`, Topic to
 * `TopicServerInstaller`, and Governance's two ingestion pipelines register
 * inside `AppGovernanceEventingAdapter.register()`.
 *
 * That third shape is why this file exists rather than a count: the sweep
 * found 22 registrations, the worker declares 24 features, and the missing
 * one was not missing at all — it was registered somewhere the obvious
 * reading does not look. Each call is asserted by name, so a feature that
 * stops registering is a failure here and not a quiet subtraction.
 */
const INSTALLER_REGISTERED: Readonly<Record<string, string>> = {
  "TraceProcessingServerInstaller.create": "trace",
  "this.deps.topicClustering.installer.install": "topic",
  "AppGovernanceEventingAdapter.create": "governance-ingestion",
};

/**
 * Every expression the legacy registry passes to its recorder.
 *
 * `registerPipeline` is the private method every registration goes through —
 * recording the definition for `exportWorkerCapabilities()` and delegating to
 * `eventSourcing.register`. Reading the recorder rather than the delegate is
 * what keeps this sweep pointed at the call sites a reader sees.
 */
function legacyRegistrationExpressions(): string[] {
  const lines = readFileSync(REGISTRY, "utf8").split("\n");
  const found: string[] = [];
  for (const [index, line] of lines.entries()) {
    if (!line.includes("this.registerPipeline(")) continue;
    // The expression is on the same line or the next one, depending only on
    // where the formatter broke the call.
    const call = `${line.trim()} ${(lines[index + 1] ?? "").trim()}`;
    const match = /registerPipeline\(\s*([A-Za-z0-9_.]+)/.exec(call);
    expect(
      match,
      `no registered expression read at pipelineRegistry.ts:${index + 1}`,
    ).not.toBeNull();
    found.push(match![1]!);
  }
  return found;
}

function workerFeatures(): string[] {
  const catalogue = JSON.parse(readFileSync(WORKER_CATALOGUE, "utf8")) as { features: string[] };
  return catalogue.features;
}

describe("worker pipeline parity", () => {
  describe("given the live legacy registry", () => {
    it("registers only pipelines this table accounts for", () => {
      const registered = legacyRegistrationExpressions();

      // Both directions, so a renamed recorder that matches nothing fails here
      // rather than reporting an empty sweep as a clean one.
      expect([...new Set(registered)].sort(), "the sweep read no registrations at all").toEqual(
        Object.keys(LEGACY_REGISTRATIONS).sort(),
      );
    });

    it("still registers Trace and Topic through their installers", () => {
      const source = readFileSync(REGISTRY, "utf8");

      for (const call of Object.keys(INSTALLER_REGISTERED)) {
        expect(source, `${call} is no longer called by the legacy registry`).toContain(call);
      }
    });
  });

  describe("given the worker composition it is moving to", () => {
    /**
     * The load-bearing one. Equality in both directions: a legacy pipeline
     * with no worker installer stops being consumed at the switchover, and a
     * worker installer with no legacy counterpart registers a second pipeline
     * under a name the legacy graph is already using.
     */
    it("declares exactly the features the legacy registry registers", () => {
      const legacy = new Set([
        ...Object.values(LEGACY_REGISTRATIONS),
        ...Object.values(INSTALLER_REGISTERED),
      ]);

      expect([...workerFeatures()].sort()).toEqual([...legacy].sort());
    });
  });
});

/**
 * A permissive stand-in for the ~77 collaborators `PipelineRegistry` takes:
 * every access yields something callable, constructible and chainable.
 *
 * It is enough because a pipeline DEFINITION is a static description — its
 * routing keys come from the command, projection, subscriber and process names
 * the feature package declares, never from the ports those handlers will later
 * call. Four collaborators are supplied for real below, because they carry the
 * definition itself rather than a port it uses.
 */
function autoStub(): any {
  const stub = () => autoStub();
  return new Proxy(stub, {
    get: (_target, property) => {
      if (property === "then") return undefined; // never look thenable to `await`
      if (property === Symbol.toPrimitive) return () => "stub";
      return autoStub();
    },
    apply: () => autoStub(),
    construct: () => autoStub(),
  });
}

/**
 * The SaaS cross-pipeline pair, configured on the runtime rather than on any
 * pipeline. Their `global:` keys share the queue with every pipeline's, so a
 * consumer without them rejects every billable span, evaluation, experiment
 * and simulation event for redelivery.
 */
const configureGlobalProjections: EventSourcingOptions["configureGlobalProjections"] = (
  registry,
) => {
  registry.registerMapProjection(orgBillableEventsMeterProjection);
  registry.registerMapSubscriber(
    "orgBillableEventsMeter",
    createBillingMeterDispatchSubscriber({ getDispatch: () => async () => void 0 }),
  );
};

type ExpectedJobRegistry = {
  version: number;
  queue: string;
  pipelines: { name: string; feature: string; jobs: string[] }[];
  globalProjections: { pipeline: string; jobs: string[] };
};

function expectedJobRegistry(): ExpectedJobRegistry {
  return JSON.parse(readFileSync(WORKER_JOB_REGISTRY, "utf8")) as ExpectedJobRegistry;
}

/** The routing keys the checked-in expectation says the queue carries. */
function expectedRoutingKeys(expected: ExpectedJobRegistry): string[] {
  return [
    ...expected.pipelines.flatMap((pipeline) =>
      pipeline.jobs.map((job) => `${pipeline.name}:${job}`),
    ),
    ...expected.globalProjections.jobs.map(
      (job) => `${expected.globalProjections.pipeline}:${job}`,
    ),
  ].sort();
}

type BuiltRegistry = {
  /** Pipeline names in mount order. */
  pipelines: string[];
  /** Every `${pipeline}:${jobType}:${jobName}` the shared queue can route. */
  routingKeys: string[];
};

type LegacyBuild = BuiltRegistry & {
  /**
   * The registry's own production export seam, rather than what spies could
   * observe of its internals. Anything this cannot carry across is a gap in
   * the switch itself, not in the test.
   */
  capabilities: PipelineRegistryWorkerCapabilities;
  topicInstallerOptions: unknown;
};

/**
 * Builds the live legacy registry against in-memory Eventing stores.
 *
 * Four collaborators are real rather than stubbed, because each one IS a
 * pipeline definition (or the installer that produces one) rather than a port
 * a handler calls: Metric, Log, AuthZ and Topic. Stubbed, they register
 * unnamed pipelines and four of the twenty-six keys' namespaces vanish.
 */
function buildLegacyRegistry(): LegacyBuild {
  const eventSourcing = new EventSourcing({
    enabled: true,
    eventStore: EventStoreMemory.createForTesting(),
    processStore: InMemoryProcessStore.createForTesting(),
    // Producer-only: this suite reads the registry, it never claims the queue.
    consumersEnabled: false,
    executionTarget: "worker",
    configureGlobalProjections,
  });

  const redaction = autoStub();
  const topicInstallerOptions = {
    database: autoStub(),
    processStore: InMemoryProcessStore.createForTesting(),
    redis: null,
    execution: autoStub(),
    metrics: autoStub(),
  };

  const supplied: Record<string, unknown> = {
    eventSourcing,
    logProcessing: LogRuntimeAdapter.createUnavailable({
      defaultRetentionDays: 30,
      logCommandShardCount: 1,
      redaction,
    }),
    metricProcessing: MetricRuntimeAdapter.createUnavailable({
      defaultRetentionDays: 30,
      metricCommandShardCount: 1,
      redaction,
    }),
    authz: {
      pipeline: AuthzFeature.create({
        database: autoStub(),
        redis: autoStub(),
        newBindingId: () => "binding",
        cacheEnabled: () => false,
      } as never).pipeline,
      connect: () => void 0,
    },
    topicClustering: { installer: TopicServerInstaller.create(topicInstallerOptions as never) },
    enterprisePipelines: autoStub(),
  };

  const registry = new PipelineRegistry(
    new Proxy(supplied, {
      get: (target, property) =>
        property in target ? (target as Record<string | symbol, unknown>)[property] : autoStub(),
    }) as never,
  );
  registry.registerAll();

  return {
    pipelines: eventSourcing.definitions.map((definition) => definition.metadata.name),
    routingKeys: [...eventSourcing.globalJobRegistry.keys()].sort(),
    capabilities: registry.exportWorkerCapabilities(),
    topicInstallerOptions,
  };
}

describe("worker capability export", () => {
  describe("given a registry whose pipelines have not been registered", () => {
    /**
     * Exporting first would hand a caller an empty graph rather than an error,
     * and the packaged consumer built from it would claim `event-sourcing/jobs`
     * with nothing to route the queue's jobs to.
     */
    it("refuses to export, and says which call has to come first", () => {
      const registry = new PipelineRegistry(autoStub());

      expect(() => registry.exportWorkerCapabilities()).toThrow(
        "PipelineRegistry.exportWorkerCapabilities() exports what registerAll() registered; call registerAll() first.",
      );
    });
  });
});

class NoopLifecycle extends WorkerLifecyclePort {
  async close(): Promise<void> {}
}

class NoopHandle extends WorkerHandlePort {
  async shutdown(): Promise<void> {}
}

class NoopTransport extends WorkerTransportPort {
  async start(): Promise<WorkerHandlePort> {
    return new NoopHandle();
  }
}

/** The process-manager persistence surface, answering without a database. */
function processPersistenceDatabase() {
  return {
    $executeRaw: async () => 0,
    $queryRaw: async () => [],
    $transaction: async <Result>(run: (transaction: object) => Promise<Result>) => run({}),
    processManagerInbox: {},
    processManagerInstance: {},
    processManagerOutbox: {},
    processManagerOutboxAttempt: {},
  };
}

/**
 * Mounts the same definitions through `WorkerProductionComposition` — the
 * production entry point, with its own ordering and its own Eventing runtime.
 *
 * The capabilities hand back the definitions the legacy registry produced.
 * That is the point: a future composition root will build them from the
 * feature packages directly, and what this proves is that the worker's
 * installer graph carries all of them onto one runtime, in mount order, with
 * no key gained or lost on the way.
 */
async function buildPackagedRegistry(legacy: LegacyBuild): Promise<BuiltRegistry> {
  const definition = (name: string) => legacy.capabilities.definition(name) as never;

  // Topic's boot seeds are a one-time data migration that pages Postgres, not
  // a registration; `worker-feature-registration-order` covers that the
  // installer invokes them.
  const bootSeeds = vi
    .spyOn(TopicServerInstaller.prototype, "startBootSeeds")
    .mockImplementation(() => void 0);

  try {
    const composition = WorkerProductionComposition.create({
      config: resolveWorkerConfig({ NODE_ENV: "test" }),
      eventing: {
        database: processPersistenceDatabase() as never,
        resolveClickHouseClient: (async () => ({
          insert: async () => undefined,
          query: async () => ({ json: async () => [] }),
        })) as never,
        groupQueue: { redis: {} as never },
        retention: createEventingRetentionConfiguration({ defaultRetentionDays: 30 }),
      },
      lifecycle: new NoopLifecycle(),
      transport: new NoopTransport(),
      globalProjections: { configure: configureGlobalProjections },
      automation: { installer: { buildPipeline: () => definition("automations") } },
      eventingMaintenance: legacy.capabilities.eventingMaintenance,
      langyMaintenance: { installer: { buildProcessing: () => definition("langy_maintenance") } },
      apiKey: { installer: { buildMaintenance: () => definition("agent_sandbox_maintenance") } },
      github: { installer: { buildMaintenance: () => definition("github_maintenance") } },
      evaluation: { installer: { buildProcessing: () => definition("evaluation_processing") } },
      codingAgent: { installer: { buildProcessing: () => definition("coding_agent_processing") } },
      gatewaySpend: {
        governance: { buildProcessing: () => definition("governance_events_processing") },
        spend: {
          buildProcessing: () => definition("gateway_spend_processing"),
          connectSettlement: () => void 0,
        },
      },
      metric: { installer: { buildProcessing: () => definition("metric_processing") } },
      log: { installer: { buildProcessing: () => definition("log_processing") } },
      trace: {
        installer: TraceProcessingServerInstaller.create(legacy.capabilities.trace),
      },
      topic: legacy.topicInstallerOptions as never,
      suite: { installer: { buildProcessing: () => definition("suite_run_processing") } },
      scenario: {
        installer: {
          buildProcessing: () => definition("simulation_processing"),
          deferredComputeRunMetricsJob: {
            name: DEFERRED_COMPUTE_RUN_METRICS_JOB,
            delayMs: 30_000,
            makeJobId: () => "retry",
            spanAttributes: () => ({}),
          },
          connect: () => void 0,
        },
      },
      experiment: {
        installer: { buildProcessing: () => definition("experiment_run_processing") },
      },
      langyConversation: {
        installer: {
          buildProcessing: () => definition("langy_conversation_processing"),
          connectCommands: () => void 0,
        },
      },
      governanceIngestion: {
        installer: {
          register: (eventSourcing: never) =>
            AppGovernanceEventingAdapter.create(
              eventSourcing,
              legacy.capabilities.governanceRuntime,
            ).register(),
        },
      },
      billingReporting: {
        installer: {
          buildProcessing: () => definition("billing_reporting"),
          connectSelfDispatch: () => void 0,
        },
      },
      authz: { installer: { pipeline: definition("authz_grant"), connect: () => void 0 } },
      identity: {
        identity: { pipeline: definition("identity") },
        ssoConnection: { pipeline: definition("sso-connections") },
        scimSync: { pipeline: definition("scim-sync") },
        joinRequest: { pipeline: definition("join-requests") },
      },
    } as never);

    const mounted: string[] = [];
    const eventSourcing = composition.eventing.eventSourcing;
    const register = eventSourcing.register.bind(eventSourcing);
    vi.spyOn(eventSourcing, "register").mockImplementation((candidate) => {
      mounted.push(candidate.metadata.name);
      return register(candidate);
    });

    const handles = [];
    for (const installer of composition.featureInstallers) {
      handles.push(await installer.install());
    }
    for (const handle of handles.reverse()) await handle.close();

    return {
      pipelines: mounted,
      routingKeys: [...eventSourcing.globalJobRegistry.keys()].sort(),
    };
  } finally {
    bootSeeds.mockRestore();
  }
}

/**
 * Scenario's delayed metrics retry is registered as a queue job rather than
 * declared by its pipeline, so its name is the one routing key a capability
 * supplies directly. It has no owner in `@langwatch/scenario-server` yet — the
 * live registry spells it inline — which is why it is a named constant here
 * and not a literal buried in the capability below.
 */
const DEFERRED_COMPUTE_RUN_METRICS_JOB = "deferredComputeRunMetrics";

describe("worker routing-key parity", () => {
  describe("given the live legacy registry built against in-memory Eventing", () => {
    it("routes exactly the keys the worker's checked-in expectation names", () => {
      const expected = expectedJobRegistry();
      const legacy = buildLegacyRegistry();

      expect(legacy.pipelines).toEqual(expected.pipelines.map((pipeline) => pipeline.name));
      expect(legacy.routingKeys).toEqual(expectedRoutingKeys(expected));
    });
  });

  describe("given the packaged worker composition mounting the same definitions", () => {
    it("mounts them in the same order the legacy registry does", async () => {
      const expected = expectedJobRegistry();
      const packaged = await buildPackagedRegistry(buildLegacyRegistry());

      expect(packaged.pipelines).toEqual(expected.pipelines.map((pipeline) => pipeline.name));
    });

    /**
     * The load-bearing one. `event-sourcing/jobs` is a single queue and an
     * unroutable job is rejected for redelivery rather than dropped, so a
     * packaged consumer missing one key stalls that key's work indefinitely
     * while every health signal stays green.
     */
    it("can route every key the legacy consumer routes, and no other", async () => {
      const legacy = buildLegacyRegistry();
      const packaged = await buildPackagedRegistry(legacy);

      expect(packaged.routingKeys).toEqual(legacy.routingKeys);
      expect(packaged.routingKeys).toEqual(expectedRoutingKeys(expectedJobRegistry()));
    });
  });
});
