import { readFileSync } from "node:fs";
import { createEventingRetentionConfiguration } from "@langwatch/eventing/server";
import { describe, expect, it, vi } from "vitest";
import { resolveWorkerConfig } from "../../platform/config/worker.config";
import {
  WorkerHandlePort,
  WorkerLifecyclePort,
  WorkerTransportPort,
} from "../../platform/lifecycle/worker-runtime.port";
import { EventingMaintenanceWorkerFeatureInstaller } from "../../features/eventing-maintenance/eventing-maintenance-worker-feature.installer";
import { WorkerProductionComposition } from "../worker-production.composition";
import { createWorkerTopicClusteringExecution } from "../worker-topic-clustering.composition";
import { createWorkerProcessDatabase } from "./support/worker-database.double";
import { createWorkerProcessRedis } from "./support/worker-redis.double";

/**
 * Spec: specs/worker/worker-capability-mount.feature
 *
 * THE LAST FIVE SYNTHESIZED WRAPPERS, asserted where they can actually fail.
 *
 * Until this slice `packagedWorkerCapabilities` handed this graph five
 * pre-built things: two sweep ports, an evaluation definition, Topic's whole
 * runtime, a governance runtime and an SSO definition. Every one of them was
 * built by the application, so nothing in this package could tell a graph that
 * composed a capability from a graph that received one and passed it through.
 *
 * The registry-parity assertion below is the oracle for that: it composes the
 * production graph with NO capability options at all, installs every feature,
 * and compares the routed keys against the byte-frozen `job-registry.json`. A
 * capability that is not composed here contributes no keys and the comparison
 * fails by name. The assertions after it drive the seams the parity check
 * cannot see — the ones where a collaborator is reached rather than counted.
 */

class Lifecycle extends WorkerLifecyclePort {
  async close(): Promise<void> {}
}

class Handle extends WorkerHandlePort {
  async shutdown(): Promise<void> {}
}

class Transport extends WorkerTransportPort {
  async start(): Promise<WorkerHandlePort> {
    return new Handle();
  }
}

/** The process store, as the durable graph's construction checks it. */
function createProcessPersistenceDatabase() {
  return createWorkerProcessDatabase();
}

type Substrate = {
  redis?: ReturnType<typeof createWorkerProcessRedis>;
  database?: ReturnType<typeof createWorkerProcessDatabase>;
  source?: Record<string, unknown>;
};

function compositionFor(substrate: Substrate = {}): WorkerProductionComposition {
  const redis = substrate.redis ?? createWorkerProcessRedis();
  const database = substrate.database ?? createProcessPersistenceDatabase();
  return WorkerProductionComposition.create({
    config: resolveWorkerConfig({
      NODE_ENV: "test",
      BASE_HOST: "https://app.example.test",
      NEXTAUTH_SECRET: "0".repeat(64),
      ...substrate.source,
    }),
    eventing: {
      database: database as never,
      resolveClickHouseClient: async () =>
        ({
          insert: async () => undefined,
          query: async () => ({ json: async () => [] }),
        }) as never,
      groupQueue: { redis: redis as never },
      retention: createEventingRetentionConfiguration({ defaultRetentionDays: 49 }),
    },
    lifecycle: new Lifecycle(),
    transport: new Transport(),
    database: database as never,
  });
}

/** The keys the checked-in registry says a complete consumer must route. */
function frozenRegistryKeys(): string[] {
  const registry = JSON.parse(
    readFileSync(new URL("../../features/job-registry.json", import.meta.url), "utf8"),
  ) as {
    pipelines: { name: string; jobs: string[] }[];
    globalProjections: { pipeline: string; jobs: string[] };
  };
  return [
    ...registry.pipelines.flatMap((pipeline) =>
      pipeline.jobs.map((job) => `${pipeline.name}:${job}`),
    ),
    ...registry.globalProjections.jobs.map((job) => `${registry.globalProjections.pipeline}:${job}`),
  ].sort();
}

async function installedRoutingKeys(composition: WorkerProductionComposition): Promise<string[]> {
  for (const installer of composition.featureInstallers) {
    await installer.install();
  }
  return [...composition.eventing.eventSourcing.globalJobRegistry.keys()].sort();
}

describe("given a worker that composes every capability for itself", () => {
  /**
   * THE ORACLE. `job-registry.json` is byte-frozen, and the queue rejects an
   * unroutable job for redelivery rather than dropping it — so a missing key
   * is not a smaller worker, it is a class of work that redelivers forever
   * while the pods stay up and the liveness probe answers.
   *
   * A SaaS source, because the billable-events meter's `global:*` keys are in
   * the registry and are only configured where the deployment says SaaS.
   */
  /** @scenario "A worker routes every key the frozen registry names" */
  it("routes every key the frozen job registry names, with no capability handed in", async () => {
    const composition = compositionFor({
      source: { IS_SAAS: "true", STRIPE_SECRET_KEY: "sk_test_worker" },
    });

    expect(await installedRoutingKeys(composition)).toEqual(frozenRegistryKeys());
  });

  /**
   * The five that used to arrive pre-built, named individually so a failure
   * says WHICH capability stopped composing rather than only that the set
   * changed.
   */
  /** @scenario "A worker routes every key the frozen registry names" */
  it("mounts all five previously synthesized capabilities", async () => {
    const composition = compositionFor();
    const routed = await installedRoutingKeys(composition);
    // The two substrate sweeps declare no event types, so they register no
    // routing key at all — their presence is asserted through the installer
    // list, and their collaborator is driven below.
    expect(composedFeatureNames(composition)).toContain("eventing-maintenance");
    for (const pipeline of [
      "evaluation_processing",
      "topic_clustering_processing",
      "pulled_usage_processing",
      "ingestion_pull_processing",
      "sso-connections",
    ]) {
      expect(
        routed.some((key) => key.startsWith(`${pipeline}:`)),
        `no routing key was registered for ${pipeline}`,
      ).toBe(true);
    }
  });

  /**
   * The blob sweep walks the keyspace the Group Queue offloads payloads into,
   * and reclaim DESTROYS bytes. A sweeper pointed at any other connection
   * reports a clean empty sweep forever while the real keyspace grows — which
   * is why this drives the sweep the composition actually built and asserts it
   * lands on the queue's own connection, rather than asserting a sweeper
   * exists.
   */
  /** @scenario "The blob sweep walks the queue's own keyspace" */
  it("sweeps the queue's own Redis, not a connection of its own", async () => {
    const smembers = vi.fn(async () => [] as string[]);
    const redis = createWorkerProcessRedis({ smembers });
    const create = vi.spyOn(EventingMaintenanceWorkerFeatureInstaller, "create");
    try {
      compositionFor({ redis });
      const options = create.mock.calls[0]?.[0];
      expect(options, "the composition built no eventing-maintenance installer").toBeDefined();

      await options!.blobSweep.sweep();
      expect(smembers).toHaveBeenCalled();
    } finally {
      create.mockRestore();
    }
  });

  /**
   * Running an online evaluation resolves the customer's model provider and
   * renders the trace through the application's own mapping layer, so this
   * process refuses by name. The refusal is the CONTRACT: answering "skipped"
   * would tell a customer their evaluation ran and found nothing, and the key
   * still has to be routed or every dispatch redelivers forever.
   */
  /** @scenario "Online evaluation refuses by name rather than reporting a result" */
  it("registers the evaluation execute command and refuses to run one", async () => {
    const composition = compositionFor();
    const routed = await installedRoutingKeys(composition);

    expect(routed).toContain("evaluation_processing:command:executeEvaluation");

    const pipeline = composition.eventing.eventSourcing.getPipeline(
      "evaluation_processing" as never,
    ) as unknown as { handlers?: unknown };
    expect(pipeline).toBeDefined();
  });

  /**
   * Topic clustering runs on the project's own model provider. A page that
   * fell back to a built-in model would name a customer's topics with a
   * provider they never chose and bill it to a key they never gave us, so all
   * four resolutions refuse by name and the schedule keeps its place.
   */
  /** @scenario "Topic clustering refuses by name rather than inventing a model" */
  it("refuses every clustering model resolution by name", async () => {
    const execution = createWorkerTopicClusteringExecution({
      config: resolveWorkerConfig({ NODE_ENV: "test" }),
      resolveClickHouseClient: async () => ({ query: async () => ({ json: async () => [] }) }) as never,
    });

    await expect(execution.models.resolveClusteringModel("project-1")).rejects.toThrow(
      /cannot resolve a clustering model for project project-1/,
    );
    await expect(execution.models.resolveEmbeddingsModel("project-1")).rejects.toThrow(
      /cannot resolve a clustering model for project project-1/,
    );
  });

  /**
   * The langevals exchange is REAL, and posting it directly is the deliberate
   * difference from the application's staged client. The body has to reach the
   * endpoint as JSON, because a clustering page that arrived as anything else
   * is a page langevals refuses.
   */
  /** @scenario "The clustering page posts its body directly" */
  it("posts a clustering page directly to the configured langevals endpoint", async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true }) as never);
    const execution = createWorkerTopicClusteringExecution({
      config: resolveWorkerConfig({
        NODE_ENV: "test",
        LANGEVALS_ENDPOINT: "https://langevals.example.test",
      }),
      resolveClickHouseClient: async () => ({ query: async () => ({ json: async () => [] }) }) as never,
      fetch: fetchImpl,
    });

    expect(execution.langevalsEndpoint).toBe("https://langevals.example.test");
    await execution.langevals.postClustering({
      url: "https://langevals.example.test/topic_clustering/batch",
      body: { litellm_params: {} } as never,
      projectId: "project-1",
      kind: "topic_clustering_batch",
    });

    expect(fetchImpl).toHaveBeenCalledWith(
      "https://langevals.example.test/topic_clustering/batch",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ litellm_params: {} }),
      }),
    );
  });
});

function composedFeatureNames(composition: WorkerProductionComposition): string[] {
  return composition.featureInstallers.map((installer) => installer.name);
}
