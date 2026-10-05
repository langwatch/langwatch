import { parseProcessConfig } from "@langwatch/config";
import { EventSourcing, InMemoryProcessStore } from "@langwatch/eventing";
import {
  createBlobMaintenancePipeline,
  createProcessManagerMaintenancePipeline,
  type BlobCleanupDeps,
  type ProcessRetentionSweepDeps,
} from "@langwatch/eventing/server";
import { EventStoreMemory } from "@langwatch/eventing/testing";
import { ModuleApiToken } from "@langwatch/module";
import {
  bootInstalledProcess,
  type InstallableServerFeature,
  processConfig,
  storesBackedMembers,
  withMemoryRepositories,
} from "@langwatch/process";
import {
  aesEncryption,
  memoryStores,
  resolvedSecrets,
  systemClock,
  type ProcessMembers,
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

function overMemory(module: InstallableServerFeature<never>): InstallableServerFeature<never> {
  return module.repositoryRegistry === void 0 ? module : withMemoryRepositories(module);
}

/** A SaaS deployment: the flag and a synthetic, never-called Stripe key its reports need. */
const SAAS_ENVIRONMENT: Readonly<Record<string, string>> = {
  ...SYNTHETIC_ENVIRONMENT,
  IS_SAAS: "true",
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

  const prisma = unreachable<ProcessMembers["prisma"]>("prisma");
  const eventing = new EventSourcing({
    ...(live ? { eventStore: EventStoreMemory.createForTesting() } : { enabled: false }),
    participation: "consume",
    processStore: InMemoryProcessStore.createForTesting(),
    maintenance: () => [
      createBlobMaintenancePipeline({ cleanup: unreachable<BlobCleanupDeps>("blob sweep") }),
      createProcessManagerMaintenancePipeline({
        retentionSweep: unreachable<ProcessRetentionSweepDeps>("process retention sweep"),
      }),
    ],
  });
  const stores: Partial<ProcessMembers> = {
    logger: createTestLogger().logger,
    clock: systemClock(),
    secrets: resolvedSecrets({}),
    encryption: aesEncryption(new Uint8Array(32)),
    telemetry: unreachable<ProcessMembers["telemetry"]>("telemetry"),
    prisma,
    clickhouse: unreachable<ProcessMembers["clickhouse"]>("clickhouse"),
    objectStorage: unreachable<ProcessMembers["objectStorage"]>("objectStorage"),
    cache: unreachable<ProcessMembers["cache"]>("cache"),
    idempotency: { claim: async () => true },
    rateLimiter: { check: async () => ({ allowed: true }) },
    eventing,
  };
  const runtime = await bootInstalledProcess({
    role: ROLE,
    modules: processModules.map(overMemory),
    config,
    secrets: (owner, declared) => resolver.scopeTo(owner, declared),
    members: {
      ...storesBackedMembers(memoryStores(), {
        ...stores,
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
        rawSocketPort: 0,
        monitor: void 0,
        langwatchQl: {
          admin: { configured: false },
          postgres: { configured: false },
          database: () => prisma,
        },
      }),
      close: async () => void 0,
    },
  });
  return { runtime, eventing };
}

const moduleApis = processModules.flatMap((module) =>
  module.apiContract instanceof ModuleApiToken ? [module.apiContract] : [],
);

describe("the worker process installation", () => {
  /** @scenario "Every installed module boots in the worker role over memory stores" */
  it("boots every installed module and hosts the pipelines and schedules the modules declare", async () => {
    const { runtime, eventing } = await bootWorker();

    try {
      for (const token of moduleApis) expect(runtime.service(token)).toBeDefined();
      const pipelines = eventing.definitions.map((definition) => definition.metadata.name);
      expect(pipelines).toContain("experiment_run_processing");
      expect(pipelines).toContain("coding_agent_processing");
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
  it("hosts the span dispatch on trace and coding-agent's log and metric peer lanes", async () => {
    const { runtime, eventing } = await bootWorker();

    try {
      const byName = new Map(
        eventing.definitions.map((definition) => [definition.metadata.name, definition]),
      );
      expect([
        ...(byName
          .get("trace_processing")
          ?.open((definition) => [...definition.eventSubscribers.keys()]) ?? []),
      ]).toContain("codingAgentSpanFactsDispatch");
      expect(
        byName
          .get("coding_agent_processing")
          ?.open((definition) => definition.globalProjections?.map(({ name }) => name)),
      ).toEqual(
        expect.arrayContaining([
          "coding_agent_processing.codingAgentLogFactsDispatch",
          "coding_agent_processing.codingAgentMetricFactsDispatch",
        ]),
      );
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
  it("declares the billable-events meter on the usage pipeline of a SaaS worker", async () => {
    const { runtime, eventing } = await bootWorker({ saas: true });

    try {
      const usage = eventing.definitions.find((definition) => definition.metadata.name === "usage");
      expect(
        usage?.open((definition) => definition.globalProjections?.map(({ name }) => name)),
      ).toEqual(["orgBillableEventsMeter"]);
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

  /** @scenario "The worker routes span recording to the trace pipeline" */
  it("registers the trace pipeline's recordSpan handler in the job registry it consumes", async () => {
    const { runtime, eventing } = await bootWorker({ live: true });

    try {
      expect(eventing.globalJobRegistry.has("trace_processing:command:recordSpan")).toBe(true);
    } finally {
      await runtime.stop();
    }
  });
});
