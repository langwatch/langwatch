import { readdirSync } from "node:fs";

import { parseProcessConfig } from "@langwatch/config";
import { EventSourcing, laneAliasesPastWindow } from "@langwatch/eventing";
import {
  createBlobMaintenancePipeline,
  createProcessManagerMaintenancePipeline,
  type BlobCleanupDeps,
  type ProcessRetentionSweepDeps,
} from "@langwatch/eventing/server";
import { EventStoreMemory } from "@langwatch/eventing/testing";
import { ModuleApiToken } from "@langwatch/module";
import { type BootedRuntime, createApp, processConfig } from "@langwatch/process";
import {
  aesEncryption,
  memoryStores,
  resolvedSecrets,
  systemClock,
} from "@langwatch/process-stores";
import {
  refuseDoubleClaims,
  SecretsChain,
  SecretsResolver,
  type SecretHandle,
} from "@langwatch/secrets";
import { createTestLogger } from "@langwatch/test-harness";
/**
 * The worker installed as `main.ts` installs it, over memory stores (ARCHITECTURE.md §13).
 * @vitest-environment node
 * @see specs/platform/process-installation.feature
 */
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it } from "vitest";

import { processModules } from "../process-modules.generated.ts";

const ROLE = "worker";
/** Every value is harmless and invented: nothing here is read from `.env`. */
const SYNTHETIC_ENVIRONMENT: Readonly<Record<string, string>> = {
  NODE_ENV: "test",
  // No quick tunnel from a test process: it would open a real one where cloudflared is on PATH.
  VOICE_TUNNEL: "false",
  BASE_HOST: "http://langwatch.test",
  // The API-key pepper chain refuses a boot where none of its secrets is set.
  API_KEY_PEPPER: "synthetic-api-key-pepper",
};

function unreachable<Client extends object>(name: string): Client {
  return createApiFixture<Client>({}, `${name} (no raw client over memory stores)`);
}

/**
 * The supply chain over the whole installed list: its per-module type check does not close over
 * thirty modules, so this names only the calls the harness makes.
 */
interface WholeListSupply {
  withModules(modules: readonly unknown[]): WholeListSupply;
  withConfig(config: unknown): WholeListSupply;
  withStores(stores: ReturnType<typeof memoryStores>): WholeListSupply;
  withMembers(members: Readonly<Record<string, unknown>>): WholeListSupply;
  withEventing(eventing: EventSourcing): WholeListSupply;
  boot(): Promise<BootedRuntime<Record<string, unknown>, unknown, unknown>>;
}

/**
 * A SaaS deployment: the flag and a synthetic, never-called Stripe key its reports need.
 * Memory stores have no Redis for the Instant Evals budget holds, so the bound is off.
 */
const SAAS_ENVIRONMENT: Readonly<Record<string, string>> = {
  ...SYNTHETIC_ENVIRONMENT,
  IS_SAAS: "true",
  INSTANT_EVAL_BOUNDED: "false",
  STRIPE_SECRET_KEY: "sk_test_synthetic",
};

async function bootWorker({ live = false, saas = false }: { live?: boolean; saas?: boolean } = {}) {
  const environment = saas ? SAAS_ENVIRONMENT : SYNTHETIC_ENVIRONMENT;
  const owners = processConfig(processModules, ROLE);
  const config = parseProcessConfig({ owners, environment });
  const resolver = SecretsResolver.over(SecretsChain.start({ environment }).withEnv());
  refuseDoubleClaims(owners);
  const declared: readonly SecretHandle<unknown>[] = owners.flatMap((owner) =>
    "secrets" in owner ? Object.values(owner.secrets ?? {}) : [],
  );
  await resolver.preflight(declared);

  const stores = memoryStores();
  const eventing = new EventSourcing({
    ...(live ? { eventStore: EventStoreMemory.createForTesting() } : { enabled: false }),
    participation: "consume",
    processStore: stores.processStore,
    maintenance: () => [
      createBlobMaintenancePipeline({ cleanup: unreachable<BlobCleanupDeps>("blob sweep") }),
      createProcessManagerMaintenancePipeline({
        retentionSweep: unreachable<ProcessRetentionSweepDeps>("process retention sweep"),
      }),
    ],
  });
  const supply: WholeListSupply = createApp({
    role: ROLE,
    secrets: (owner, handles) => resolver.scopeTo(owner, handles),
  });
  const runtime = await supply
    .withModules(processModules)
    .withConfig(config)
    .withStores(stores)
    .withMembers({
      logger: createTestLogger().logger,
      clock: systemClock(),
      secrets: resolvedSecrets({}),
      encryption: aesEncryption(new Uint8Array(32)),
      telemetry: unreachable<object>("telemetry"),
      prisma: unreachable<object>("prisma"),
      clickhouse: unreachable<object>("clickhouse"),
      objectStorage: unreachable<object>("objectStorage"),
      cache: unreachable<object>("cache"),
      idempotency: { claim: async () => true },
      rateLimiter: { check: async () => ({ allowed: true }) },
      // The memory answer for Redis is none: every Redis-backed member has a twin.
      redis: null,
      publicBaseUrl: config.process.baseHost,
      serviceVersion: "test",
      // No collector: rum answers not configured unless the test names one.
      telemetryExporter: {
        endpoint: void 0,
        withHeaders: <Out>(build: (headers: Readonly<Record<string, string>>) => Out): Out =>
          build({}),
      },
      nodeEnvironment: config.process.nodeEnvironment,
      isSaas: config.process.isSaas ?? false,
      nlpServiceUrl: config.process.nlpServiceUrl,
      nlpCodeBlockTimeoutSeconds: config.process.nlpCodeBlockTimeoutSeconds,
      nlpInternalSecret: void 0,
      outboundProxy: config.process.outboundProxy,
      processName: "langwatch-worker",
      storageResolver: void 0,
      storage: void 0,
      queue: void 0,
      content: void 0,
      connectJudge: null,
      monitor: void 0,
      langwatchQl: {
        admin: { configured: false },
        postgres: { configured: false },
        database: () => unreachable<object>("langwatchQl database"),
      },
    })
    .withEventing(eventing)
    .boot();
  return { runtime, eventing };
}

const moduleApis = processModules.flatMap((module) =>
  module.apiContract instanceof ModuleApiToken ? [module.apiContract] : [],
);

const TENANCY_AND_GATEWAY = ["organization", "project", "authz", "model-provider"] as const;

function apiNamed(name: string): ModuleApiToken<unknown> {
  const token = moduleApis.find((candidate) => candidate.name === name);
  if (token === undefined) throw new Error(`no installed module serves the ${name} API`);
  return token;
}

/** The installed modules whose declared dependencies include `token`. */
function dependentsOf(token: ModuleApiToken<unknown>): string[] {
  return processModules.flatMap((module) =>
    Object.values(module.dependencies ?? {}).includes(token) ? [module.name] : [],
  );
}

describe("the worker process installation", () => {
  /** @scenario "Every installed module boots in the worker role over memory stores" */
  it("boots every installed module and hosts the pipelines and schedules the modules declare", async () => {
    const { runtime, eventing } = await bootWorker();

    try {
      for (const token of moduleApis) expect(runtime.service(token)).toBeDefined();
      const pipelines = eventing.definitions.map((definition) => definition.metadata.name);
      expect(pipelines).toContain("experiment_run_processing");
      expect(pipelines).toContain("coding_agent_processing");
      expect(pipelines).toContain("github_lifecycle");
      expect(pipelines).toContain("evaluator_lifecycle");
      expect(pipelines).toContain("monitor_evaluator_cleanup");
      expect(pipelines).toContain("scim_sso_connections");
      expect(pipelines).not.toContain("data_retention_project_scope");
      expect(pipelines).not.toContain("data_privacy_project_scope");
      expect(pipelines).toContain("data_retention_seat_policy");
      expect(pipelines).toContain("audit_log");
      expect(pipelines).toContain("agent_lifecycle");
      expect(pipelines).toContain("annotation_lifecycle");
      expect(pipelines).toContain("agent_workflow_fields");
      expect(pipelines).toContain("user_lifecycle");
      expect(pipelines).toContain("workflow_agent_archive_cascade");
      expect(pipelines).toContain("evaluator_workflow_archive_cascade");
      expect(pipelines).toContain("share_trace_sharing_revocation");
      expect(pipelines).toContain("topic_clustering_processing");
      expect(pipelines).toContain("automations");
      expect(pipelines).toContain("evaluation_processing");
      expect(pipelines).toContain("simulation_processing");
      expect(pipelines).toContain("billing_reporting");
      expect(pipelines).toContain("gateway_spend_processing");
      expect(pipelines).toContain("webhook_delivery");
      expect(pipelines).toContain("governance_events_processing");
      expect(pipelines).toContain("pulled_usage_processing");
      expect(
        eventing.definitions
          .find((definition) => definition.metadata.name === "pulled_usage_processing")
          ?.open((definition) => definition.foldProjections.has("governanceCostRollup")),
      ).toBe(true);
      expect(pipelines).toContain("ingestion_pull_processing");
      expect(pipelines).toContain("ingestion_pull_reconcile");
      expect(pipelines).toContain("governance_activity_monitor");
      expect(pipelines).toContain("blob_maintenance");
      expect(pipelines).toContain("process_manager_maintenance");
      // Every process that is not producing resolves trace commands from this registration.
      expect(pipelines).toContain("trace_processing");
      const schedules = eventing.definitions.flatMap((definition) =>
        [...definition.processManagers.values()].flatMap((manager) =>
          manager.config.schedule ? [manager.config.name] : [],
        ),
      );
      expect(schedules).not.toEqual([]);
      expect(schedules).toContain("spendSpikeEvaluation");
      expect(schedules).toContain("governanceTraceFacts");
      // governance's aggregate reconcile: project and member facts enqueue, a daily wake sweeps.
      expect(schedules).toContain("aggregateProjectReconcile");
      // user's fact outbox: its delivered intents are pruned on the worker's daily wake.
      expect(schedules).toContain("userLifecycleFacts");
    } finally {
      await runtime.stop();
    }
  });

  /** @scenario "The worker starts the voice reconciler when it boots" */
  it("hosts the voice reconciler as a scheduled process manager", async () => {
    const { runtime, eventing } = await bootWorker();

    try {
      const maintenance = eventing.definitions.find(
        (definition) => definition.metadata.name === "gateway_realtime_session_maintenance",
      );
      expect(
        maintenance?.processManagers.get("gatewayRealtimeSessionReconcile")?.config.schedule,
      ).toEqual({ everyMs: 60_000 });
    } finally {
      await runtime.stop();
    }
  });

  /** @scenario "The worker hosts identity's four pipelines with their reactions" */
  it("hosts identity's four pipelines as consumers, and scim's directory move", async () => {
    const { runtime, eventing } = await bootWorker();

    try {
      const byName = new Map(
        eventing.definitions.map((definition) => [definition.metadata.name, definition]),
      );
      for (const name of ["identity", "join-requests", "scim-sync", "sso-connections"]) {
        expect(byName.has(name)).toBe(true);
      }
      const subscribes = (pipeline: string, subscriber: string) =>
        byName.get(pipeline)?.open((definition) => definition.eventSubscribers.has(subscriber));
      expect(subscribes("sso-connections", "scimDirectoryMove")).toBe(true);
      expect(byName.get("join-requests")?.processManagers.size).toBeGreaterThan(0);
      expect(subscribes("scim_directory", "moveDirectory")).toBe(true);
    } finally {
      await runtime.stop();
    }
  });

  /** @scenario "The worker forwards coding-agent spans, logs and metric points to coding-agent" */
  it("hosts coding-agent's span, log and metric peer lanes on coding-agent, none on trace", async () => {
    const { runtime, eventing } = await bootWorker();

    try {
      const byName = new Map(
        eventing.definitions.map((definition) => [definition.metadata.name, definition]),
      );
      expect([
        ...(byName
          .get("trace_processing")
          ?.open((definition) => [...definition.eventSubscribers.keys()]) ?? []),
      ]).not.toContain("codingAgentSpanFactsDispatch");
      expect(
        byName
          .get("coding_agent_processing")
          ?.open((definition) => definition.globalProjections?.map(({ name }) => name)),
      ).toEqual(
        expect.arrayContaining([
          "coding_agent_processing.codingAgentSpanFactsDispatch",
          "coding_agent_processing.codingAgentLogFactsDispatch",
          "coding_agent_processing.codingAgentMetricFactsDispatch",
          "coding_agent_processing.codingAgentInstallationBackfill",
        ]),
      );
    } finally {
      await runtime.stop();
    }
  });

  /** @scenario "The trigger's lanes are evaluation's own" */
  it("hosts evaluation's trigger and SDK-evaluation lanes on trace's span facts, none on trace", async () => {
    const { runtime, eventing } = await bootWorker();

    try {
      const byName = new Map(
        eventing.definitions.map((definition) => [definition.metadata.name, definition]),
      );
      const traceSubscribers = [
        ...(byName
          .get("trace_processing")
          ?.open((definition) => [...definition.eventSubscribers.keys()]) ?? []),
      ];
      expect(traceSubscribers).not.toContain("evaluationTrigger");
      expect(traceSubscribers).not.toContain("customEvaluationSync");
      expect(
        byName
          .get("evaluation_processing")
          ?.open((definition) => definition.globalProjections?.map(({ name }) => name)),
      ).toEqual(
        expect.arrayContaining([
          "evaluation_processing.traceEvaluationTrigger",
          "evaluation_processing.traceOriginEvaluationTrigger",
          "evaluation_processing.traceCustomEvaluationSync",
        ]),
      );
    } finally {
      await runtime.stop();
    }
  });

  /** @scenario "The worker hosts trace's collector evaluation pipeline and evaluation's lane on it" */
  it("hosts trace's collector evaluation pipeline and evaluation's report lane on it", async () => {
    const { runtime, eventing } = await bootWorker();

    try {
      const byName = new Map(
        eventing.definitions.map((definition) => [definition.metadata.name, definition]),
      );
      expect(byName.has("trace_collector_evaluations")).toBe(true);
      expect(
        byName
          .get("evaluation_processing")
          ?.open((definition) => definition.globalProjections?.map(({ name }) => name)),
      ).toEqual(expect.arrayContaining(["evaluation_processing.traceCollectorEvaluation"]));
    } finally {
      await runtime.stop();
    }
  });

  it("hosts suite's peer lanes on scenario's run facts, and no suite sync on scenario", async () => {
    const { runtime, eventing } = await bootWorker();

    try {
      const byName = new Map(
        eventing.definitions.map((definition) => [definition.metadata.name, definition]),
      );
      expect([
        ...(byName
          .get("simulation_processing")
          ?.open((definition) => [...definition.eventSubscribers.keys()]) ?? []),
      ]).not.toContain("suiteRunSync");
      expect(
        byName
          .get("suite_run_processing")
          ?.open((definition) => definition.globalProjections?.map(({ name }) => name)),
      ).toEqual(
        expect.arrayContaining([
          "suite_run_processing.scenarioRunStarted",
          "suite_run_processing.scenarioRunFinished",
          "suite_run_processing.scenarioRunEvaluated",
        ]),
      );
    } finally {
      await runtime.stop();
    }
  });

  /** @scenario "An alias past its release is refused so it gets removed" */
  it("carries no lane alias past the release that shipped it", async () => {
    const { runtime, eventing } = await bootWorker();

    try {
      const newestRelease = readdirSync(
        new URL("../../../../packages/upgrade/releases/", import.meta.url),
      )
        .flatMap((file) => /^(\d+\.\d+\.\d+)\.json$/.exec(file)?.[1] ?? [])
        .toSorted((a, b) => a.localeCompare(b, undefined, { numeric: true }))
        .at(-1)!;
      const declared = eventing.definitions.map((definition) => ({
        pipeline: definition.metadata.name,
        aliases: definition.open((opened) => opened.laneAliases ?? []),
      }));
      expect(laneAliasesPastWindow({ declared, newestRelease })).toEqual([]);
    } finally {
      await runtime.stop();
    }
  });

  /** @scenario "The worker hosts the gateway's spend settlement sweeper" */
  it("hosts the gateway's settlement sweeper on the spend pipeline", async () => {
    const { runtime, eventing } = await bootWorker();

    try {
      const spend = eventing.definitions.find(
        (definition) => definition.metadata.name === "gateway_spend_processing",
      );
      expect(spend?.processManagers.get("spendSettlement")?.config.schedule).toEqual({
        everyMs: 5 * 60 * 1000,
      });
    } finally {
      await runtime.stop();
    }
  });

  /** @scenario "The worker hosts the gateway's budget debits on the spend pipeline" */
  it("hosts gatewayDebits on the gateway spend pipeline, under the name its rows are keyed by", async () => {
    const { runtime, eventing } = await bootWorker();

    try {
      const spend = eventing.definitions.find(
        (definition) => definition.metadata.name === "gateway_spend_processing",
      );
      expect(spend?.processManagers.get("gatewayDebits")?.config.transient).toBe(true);
    } finally {
      await runtime.stop();
    }
  });

  it("hosts licensing's managed-key attach lane on the licensing_customer pipeline", async () => {
    const { runtime, eventing } = await bootWorker();

    try {
      const customer = eventing.definitions.find(
        (definition) => definition.metadata.name === "licensing_customer",
      );
      expect(
        customer?.open((definition) =>
          (definition.globalProjections ?? []).map(({ name }) => name),
        ),
      ).toContain("licensing_customer.licensingManagedKeyProvisioned");
    } finally {
      await runtime.stop();
    }
  });

  /** @scenario "The worker hands gateway's governance facts to webhook delivery" */
  it("hosts webhook's subscribers on gateway's governance facts and its governance delivery", async () => {
    const { runtime, eventing } = await bootWorker();

    try {
      const webhook = eventing.definitions.find(
        (definition) => definition.metadata.name === "webhook_delivery",
      );
      expect(
        webhook?.open((definition) => (definition.globalProjections ?? []).map(({ name }) => name)),
      ).toEqual(
        expect.arrayContaining([
          "webhook_delivery.gatewayBudgetCrossingDelivery",
          "webhook_delivery.gatewayVkLifecycleDelivery",
        ]),
      );
      expect(webhook?.processManagers.has("governanceEventsDelivery")).toBe(true);
    } finally {
      await runtime.stop();
    }
  });

  /** @scenario "A SaaS worker registers the billable-events meter" */
  it("declares the billable-events and trace meters on the usage pipeline of a SaaS worker", async () => {
    const { runtime, eventing } = await bootWorker({ saas: true });

    try {
      const usage = eventing.definitions.find(
        (definition) => definition.metadata.name === "entitlement",
      );
      expect(
        usage?.open((definition) => definition.globalProjections?.map(({ name }) => name)),
      ).toEqual(["entitlement.usageTraceMeter", "orgBillableEventsMeter"]);
    } finally {
      await runtime.stop();
    }
  });

  /** @scenario "the pipeline is composed from packages alone" */
  it("hosts the trace processing pipeline and routes every command and projection it declares", async () => {
    const { runtime, eventing } = await bootWorker({ live: true });

    try {
      const trace = eventing.definitions.find(
        ({ metadata }) => metadata.name === "trace_processing",
      );
      if (trace === undefined) throw new Error("the worker hosts no trace_processing pipeline");
      const routed = [
        ...trace.open((definition) => definition.commands.map(({ definition }) => definition.name)),
      ].map((name) => `trace_processing:command:${name}`);
      const projected = trace
        .open((definition) => [...definition.foldProjections.keys()])
        .map((name) => `trace_processing:projection:${name}`);

      expect(routed).not.toEqual([]);
      expect(projected).not.toEqual([]);
      for (const key of [...routed, ...projected]) {
        expect(eventing.globalJobRegistry.has(key), key).toBe(true);
      }
    } finally {
      await runtime.stop();
    }
  });

  /** @scenario "A worker routes every key the installed pipelines declare" */
  /** @scenario "The worker mounts every trace routing key" */
  it("routes exactly the command and projection keys its installed pipelines declare", async () => {
    const { runtime, eventing } = await bootWorker({ live: true });

    try {
      const declared = eventing.definitions.flatMap((pipeline) => {
        const name = pipeline.metadata.name;
        return pipeline.open((definition) => [
          ...definition.commands.map((command) => `${name}:command:${command.definition.name}`),
          ...[...definition.foldProjections.keys()].map((key) => `${name}:projection:${key}`),
        ]);
      });
      const routed = [...eventing.globalJobRegistry.keys()];
      const stray = routed.filter(
        (key) => !declared.includes(key) && /:(command|projection):/.test(key),
      );

      expect(declared).not.toEqual([]);
      expect(declared.filter((key) => !routed.includes(key))).toEqual([]);
      expect(stray).toEqual([]);
    } finally {
      await runtime.stop();
    }
  });

  /** @scenario "The worker claims every routing key the langy conversation pipeline declares" */
  it("routes every command and projection key langy's conversation pipeline declares", async () => {
    const { runtime, eventing } = await bootWorker({ live: true });

    try {
      const langy = eventing.definitions.find(
        ({ metadata }) => metadata.name === "langy_conversation_processing",
      );
      if (langy === undefined) throw new Error("the worker hosts no langy conversation pipeline");
      const declared = langy.open((definition) => [
        ...definition.commands.map(({ definition: command }) => `command:${command.name}`),
        ...[...definition.foldProjections.keys()].map((key) => `projection:${key}`),
      ]);

      expect(declared).not.toEqual([]);
      for (const key of declared) {
        expect(eventing.globalJobRegistry.has(`langy_conversation_processing:${key}`), key).toBe(
          true,
        );
      }
    } finally {
      await runtime.stop();
    }
  });

  /** @scenario "The worker hosts the queue's blob sweep and the process retention sweep" */
  it("hosts the blob and process-retention maintenance pipelines, each on a schedule", async () => {
    const { runtime, eventing } = await bootWorker();

    try {
      for (const name of ["blob_maintenance", "process_manager_maintenance"]) {
        const pipeline = eventing.definitions.find(({ metadata }) => metadata.name === name);
        const schedules = [...(pipeline?.processManagers.values() ?? [])].flatMap((manager) =>
          manager.config.schedule ? [manager.config.schedule] : [],
        );

        expect(pipeline, name).toBeDefined();
        expect(schedules, name).not.toEqual([]);
      }
    } finally {
      await runtime.stop();
    }
  });

  /** @scenario "The worker serves the organization, project and authorization capabilities together" */
  /** @scenario "The worker installs the model gateway beside the tenancy graph" */
  it("serves the tenancy and model-provider capabilities from the booted graph", async () => {
    const { runtime } = await bootWorker();

    try {
      for (const name of TENANCY_AND_GATEWAY) {
        expect(runtime.service(apiNamed(name)), name).toBeDefined();
      }
    } finally {
      await runtime.stop();
    }
  });

  /** @scenario "The tenancy graph is the one the module graph booted" */
  it("serves each tenancy capability as one instance that installed modules declare as a dependency", async () => {
    const { runtime } = await bootWorker();

    try {
      for (const name of ["organization", "project", "authz"]) {
        const token = apiNamed(name);

        expect(runtime.service(token)).toBe(runtime.service(token));
        expect(dependentsOf(token).length, name).toBeGreaterThan(0);
      }
    } finally {
      await runtime.stop();
    }
  });

  /** @scenario "Topic clustering and evaluation resolve through one gateway" */
  it("hands topic and evaluation the one model-provider instance the graph serves", async () => {
    const { runtime } = await bootWorker();

    try {
      const gateway = apiNamed("model-provider");

      expect(dependentsOf(gateway)).toEqual(expect.arrayContaining(["topic", "evaluation"]));
      expect(runtime.service(gateway)).toBe(runtime.service(gateway));
    } finally {
      await runtime.stop();
    }
  });

  /** @scenario "The worker routes span recording to the trace pipeline" */
  /** @scenario "The record command composes from a database and a configuration" */
  it("registers the trace pipeline's recordSpan handler in the job registry it consumes", async () => {
    const { runtime, eventing } = await bootWorker({ live: true });

    try {
      expect(eventing.globalJobRegistry.has("trace_processing:command:recordSpan")).toBe(true);
    } finally {
      await runtime.stop();
    }
  });
});
