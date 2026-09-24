/**
 * The worker installed as `main.ts` installs it, over memory stores (ARCHITECTURE.md §13).
 * @vitest-environment node
 * @see specs/platform/process-installation.feature
 */
import { createApiFixture } from "@langwatch/api-fixture";
import { parseProcessConfig } from "@langwatch/config";
import { EventSourcing, InMemoryProcessStore } from "@langwatch/eventing";
import {
  createBlobMaintenancePipeline,
  createProcessManagerMaintenancePipeline,
  type BlobCleanupDeps,
  type ProcessRetentionSweepDeps,
} from "@langwatch/eventing/server";
import { serverModules } from "@langwatch/installed-server-modules";
import {
  bootInstalledProcess,
  ModuleApiToken,
  storesBackedMembers,
  withMemoryRepositories,
  type InstallableServerFeature,
} from "@langwatch/kernel";
import { processConfig } from "@langwatch/process-server";
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
import { describe, expect, it } from "vitest";

const ROLE = "worker";
/** Every value is harmless and invented: nothing here is read from `.env`. */
const SYNTHETIC_ENVIRONMENT: Readonly<Record<string, string>> = {
  NODE_ENV: "test",
  BASE_HOST: "http://langwatch.test",
};

function unreachable<Client extends object>(name: string): Client {
  return createApiFixture<Client>({}, `${name} (no raw client over memory stores)`);
}

function overMemory(module: InstallableServerFeature<never>): InstallableServerFeature<never> {
  return module.repositoryRegistry === void 0 ? module : withMemoryRepositories(module);
}

async function bootWorker() {
  const owners = processConfig(serverModules, ROLE);
  const config = parseProcessConfig({ owners, environment: SYNTHETIC_ENVIRONMENT });
  const resolver = SecretsResolver.over(
    SecretsChain.start({ environment: SYNTHETIC_ENVIRONMENT }).withEnv(),
  );
  refuseDoubleClaims(owners);
  const declared: readonly SecretHandle<unknown>[] = owners.flatMap((owner) =>
    "secrets" in owner ? Object.values(owner.secrets ?? {}) : [],
  );
  await resolver.preflight(declared);

  const prisma = unreachable<ProcessMembers["prisma"]>("prisma");
  const eventing = new EventSourcing({
    enabled: false,
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
    mail: unreachable<ProcessMembers["mail"]>("mail"),
  };
  const runtime = await bootInstalledProcess({
    role: ROLE,
    modules: serverModules.map(overMemory),
    config,
    secrets: (owner, declared) => resolver.scopeTo(owner, declared),
    members: {
      ...storesBackedMembers(memoryStores(), {
        ...stores,
        // The memory answer for Redis is none: every Redis-backed member has a twin.
        redis: null,
        publicBaseUrl: config.process.baseHost,
        serviceVersion: "test",
        nodeEnvironment: config.process.nodeEnvironment,
        isSaas: config.process.isSaas ?? false,
        nlpServiceUrl: config.process.nlpServiceUrl,
        adminEmails: config.process.adminEmails,
        processName: "langwatch-worker",
        producesPipelines: false,
        dataPrivacy: { directory: unreachable<object>("dataPrivacy.directory"), redaction: null },
        elevenLabsWebhook: void 0,
        storageResolver: void 0,
        storage: void 0,
        queue: void 0,
        content: void 0,
        gatewayInternalProtocol: {},
        connectJudge: null,
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

const moduleApis = serverModules.flatMap((module) =>
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
      expect(pipelines).toContain("governance_events_processing");
      expect(pipelines).toContain("pulled_usage_processing");
      expect(pipelines).toContain("ingestion_pull_processing");
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
    } finally {
      await runtime.stop();
    }
  });
});
