/**
 * Whether the extracted worker's graph and the live legacy registry agree on
 * what they consume from `event-sourcing/jobs`.
 *
 * They are the two halves of the completed switch. `workers.ts` boots
 * `WorkerExecutable` with `PackagedWorkerExecutableComposition`, which mounts
 * `apps/worker`'s `WorkerProductionComposition` over the registry the App's
 * `PipelineRegistry` exports; the App composes as a producer only.
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
import { createEventingRetentionConfiguration } from "@langwatch/eventing/server";
import { TopicServerInstaller } from "@langwatch/topic-server";
import { resolveWorkerConfig, WorkerProductionComposition } from "@langwatch/worker";
import { packagedWorkerCapabilities } from "~/runtime/worker/packaged-worker.capabilities";
import { PipelineRegistry } from "~/server/event-sourcing/registration/pipelineRegistry";
import {
  autoStub,
  buildLegacyRegistry,
  NoopLifecycle,
  NoopTransport,
  packagedHandoff,
  processPersistenceDatabase,
  type BuiltRegistry,
  type LegacyBuild,
} from "./legacy-registry.fixture";

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

/**
 * Mounts the same definitions through `WorkerProductionComposition` — the
 * production entry point, with its own ordering and its own Eventing runtime.
 *
 * The capability options come from `packagedWorkerCapabilities`, which is the
 * mapper the cutover's composition root uses; nothing about the graph below is
 * written for this test. That is deliberate — the seam the cutover rides is the
 * seam this guard exercises, so a mapper that drops a pipeline, misnames one, or
 * loses the scenario retry job fails here rather than in production.
 *
 * Only the process boundaries are this suite's: in-memory Eventing stores, and
 * a producer-only runtime, because a guard must never claim `event-sourcing/jobs`.
 */
async function buildPackagedRegistry(legacy: LegacyBuild): Promise<BuiltRegistry> {
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
      ...packagedWorkerCapabilities({
        handoff: packagedHandoff(legacy),
        // The SaaS meter's sender is the composed graph's own in production.
        // Here nothing dispatches: the guard reads routing keys, and the
        // meter's two `global:` keys come from the projection pair, not from
        // where its subscriber sends.
        billingUsageDispatch: () => async () => void 0,
      }),
    });

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
