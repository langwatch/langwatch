import type { DataPrivacyResolutionPort } from "@langwatch/data-privacy-server";
import {
  PostgresModelCostCatalogAdapter,
  type ModelCostCatalogDatabase,
  type ModelCostCatalogService,
} from "@langwatch/model-provider-server";
import type { MonitorApi } from "@langwatch/monitor-contract";
import {
  PostgresProjectMetadataAdapter,
  type ProjectDiagnosticsPort,
  type ProjectMetadataDatabase,
  type ProjectMetadataService,
} from "@langwatch/project-server";

/**
 * The four capability services `command:recordSpan` and its subscribers read
 * through: three composed from the one Prisma client this process opened, and
 * the privacy resolution taken from the Data Privacy application it booted.
 *
 * STAGED, NOT MOUNTED. Trace has not converted — the application still owns
 * `RecordSpanCommand` and all fifteen subscribers — so nothing in this process
 * reads a project or a policy yet. What has to be true today is that this
 * composition root CAN build all four from a database and nothing else. That
 * was the halt: the four staged record-time compositions each took a capability
 * service by parameter and NONE of the six was constructible here.
 *
 * WHAT CHANGED, AND WHY IT IS NOT A LOOPHOLE. The wall was never the reads —
 * it was the writes standing behind them. `ProjectApi` requires a
 * credentials port and an `OrganizationService` because `create` mints an
 * ingestion key and `ensureInternal` resolves a team; `DataPrivacyApi`
 * requires an organization directory because `setForScope` has to decide which
 * organization a team scope belongs to; `ModelProviderApi` requires nine
 * collaborators including an `AuthzService` because writing a cost authorizes
 * a scope; `MonitorService` requires an `EvaluatorApi` because creating a
 * monitor resolves the evaluator behind it. Ingestion creates no project,
 * writes no policy, authors no cost and creates no monitor. Each feature now
 * publishes the read half as its own service and composes the wide service on
 * top of it, so both processes answer from one implementation and this one
 * stops building a write graph it never uses.
 *
 * THE COMPLETE REACH, which is what makes the split honest rather than
 * convenient:
 *
 *     ProjectMetadataService        tryGetById, tryGetWithTeam, getWithTeam,
 *                                   updateMetadata, resolveOrgAdmin
 *     DataPrivacyResolutionPort     getResolvedForProject
 *     ModelCostCatalogService       listCosts
 *     MonitorApi                    getEnabledOnMessageMonitors
 *
 * Eight operations over three Prisma models and one booted application. Nothing
 * here opens a connection, reads an environment or chooses a gateway.
 *
 * WHAT IS DELIBERATELY NOT HERE. `FeatureFlagApi` and `AnalyticsService`
 * are the other two services the record path names, and neither was ever the
 * blocker — one is a database, a cache, a config and a clock, the other is
 * `AnalyticsAdapter` over the ClickHouse resolver this process already holds.
 * They arrive with the conversion, which is when this process gains a reason
 * to open either.
 */
export function createWorkerTraceCapabilityServices(options: {
  database: WorkerTraceCapabilityDatabase;
  /**
   * Where a swallowed org-admin read reports itself.
   *
   * `resolveOrgAdmin` answers an empty resolution rather than failing the fold
   * that triggered it, so without this the only trace of a broken read is a
   * first-trace notification that silently never goes out.
   */
  diagnostics?: ProjectDiagnosticsPort;
  /**
   * The resolved privacy policy the record path redacts by. Taken rather than
   * built: the booted Data Privacy application is the one resolution this
   * process has, and a second would answer a different policy for one project.
   */
  dataPrivacy: DataPrivacyResolutionPort;
  /**
   * The monitors enabled on every message. Taken rather than built: the ONE
   * monitor application this process installs answers the same listing the
   * evaluation trigger reads, and a second reading could disagree with it.
   */
  monitors: MonitorApi;
}): WorkerTraceCapabilityServices {
  const projects = PostgresProjectMetadataAdapter.create({
    database: options.database,
    ...(options.diagnostics ? { diagnostics: options.diagnostics } : {}),
  }).build();

  return {
    projects,
    dataPrivacy: options.dataPrivacy,
    modelCosts: PostgresModelCostCatalogAdapter.create({
      database: options.database,
      projects,
    }).build(),
    monitors: options.monitors,
  };
}

/**
 * The Prisma models the record path reads, and nothing else in the client.
 *
 * Each half is the feature's own declaration rather than a list repeated here,
 * so a model a feature starts reading arrives at this seam by typecheck rather
 * than by review. The monitor listing is not here: it is answered by the
 * monitor application, over that feature's own repositories.
 */
export type WorkerTraceCapabilityDatabase = ProjectMetadataDatabase & ModelCostCatalogDatabase;

/** The four read-side capability services, each the feature's own. */
export type WorkerTraceCapabilityServices = Readonly<{
  projects: ProjectMetadataService;
  dataPrivacy: DataPrivacyResolutionPort;
  modelCosts: ModelCostCatalogService;
  monitors: Pick<MonitorApi, "getEnabledOnMessageMonitors">;
}>;
