/**
 * Whether the extracted worker's graph and the live legacy registry agree on
 * which pipelines exist.
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
 * The table below is the reviewable artefact. Every legacy registration is
 * mapped to the worker feature that owns it, and both directions are checked,
 * so adding a pipeline to either side without the other fails here.
 */
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "../../../../../..");
const REGISTRY = join(HERE, "..", "registration", "pipelineRegistry.ts");
const WORKER_CATALOGUE = join(REPO_ROOT, "apps/worker/src/features/catalogue.json");

/**
 * What each legacy `eventSourcing.register(...)` call registers, by the worker
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
 * through an `eventSourcing.register(...)` the sweep below can see: Trace
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

/** Every expression the legacy registry passes to `eventSourcing.register`. */
function legacyRegistrationExpressions(): string[] {
  const lines = readFileSync(REGISTRY, "utf8").split("\n");
  const found: string[] = [];
  for (const [index, line] of lines.entries()) {
    if (!line.includes("eventSourcing.register(")) continue;
    // The expression is on the same line or the next one, depending only on
    // where the formatter broke the call.
    const call = `${line.trim()} ${(lines[index + 1] ?? "").trim()}`;
    const match = /register\(\s*([A-Za-z0-9_.]+)/.exec(call);
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
      const unmapped = legacyRegistrationExpressions().filter(
        (expression) => !(expression in LEGACY_REGISTRATIONS),
      );

      expect(unmapped, "a legacy pipeline with no worker feature mapped to it").toEqual([]);
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
