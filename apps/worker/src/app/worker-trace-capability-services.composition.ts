import {
  PrismaDataPrivacyResolutionAdapter,
  type DataPrivacyResolutionDatabase,
  type DataPrivacyResolutionService,
} from "@langwatch/data-privacy-server";
import {
  PostgresModelCostCatalogAdapter,
  type ModelCostCatalogDatabase,
  type ModelCostCatalogService,
} from "@langwatch/model-provider-server";
import {
  PostgresMonitorCatalogAdapter,
  type MonitorCatalogDatabase,
  type MonitorCatalogService,
} from "@langwatch/monitor-server";
import {
  PostgresProjectMetadataAdapter,
  type ProjectDiagnosticsPort,
  type ProjectMetadataDatabase,
  type ProjectMetadataService,
} from "@langwatch/project-server";

/**
 * The four capability services `command:recordSpan` and its subscribers read
 * through, composed from the one Prisma client this process opened.
 *
 * STAGED, NOT MOUNTED. Trace has not converted — the application still owns
 * `RecordSpanCommand` and all fifteen subscribers — so nothing in this process
 * reads a project or a policy yet. What has to be true today is that this
 * composition root CAN build all four from a database and nothing else. That
 * was the halt: the four staged record-time compositions each took a capability
 * service by parameter and NONE of the six was constructible here.
 *
 * WHAT CHANGED, AND WHY IT IS NOT A LOOPHOLE. The wall was never the reads —
 * it was the writes standing behind them. `ProjectService` requires a
 * credentials port and an `OrganizationService` because `create` mints an
 * ingestion key and `ensureInternal` resolves a team; `DataPrivacyService`
 * requires an `OrganizationService` because `setForScope` has to decide which
 * organization a team scope belongs to; `ModelProviderService` requires nine
 * collaborators including an `AuthzService` because writing a cost authorizes
 * a scope; `MonitorService` requires an `EvaluatorService` because creating a
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
 *     DataPrivacyResolutionService  getResolvedForProject
 *     ModelCostCatalogService       listCosts
 *     MonitorCatalogService         getEnabledOnMessageMonitors
 *
 * Eight operations over four Prisma models. Nothing here opens a connection,
 * reads an environment or chooses a gateway.
 *
 * WHAT IS DELIBERATELY NOT HERE. `FeatureFlagService` and `AnalyticsService`
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
  /** How long a resolved privacy policy is reused for. Defaults to the service's own minute. */
  dataPrivacyTtlMs?: number;
}): WorkerTraceCapabilityServices {
  const projects = PostgresProjectMetadataAdapter.create({
    database: options.database,
    ...(options.diagnostics ? { diagnostics: options.diagnostics } : {}),
  }).build();

  return {
    projects,
    dataPrivacy: PrismaDataPrivacyResolutionAdapter.create({
      prisma: options.database,
      projects,
      ...(options.dataPrivacyTtlMs === undefined ? {} : { ttlMs: options.dataPrivacyTtlMs }),
    }),
    modelCosts: PostgresModelCostCatalogAdapter.create({
      database: options.database,
      projects,
    }).build(),
    monitors: PostgresMonitorCatalogAdapter.create({
      database: options.database,
    }).build(),
  };
}

/**
 * The four Prisma models the record path reads, and nothing else in the client.
 *
 * Each half is the feature's own declaration rather than a list repeated here,
 * so a model a feature starts reading arrives at this seam by typecheck rather
 * than by review.
 */
export type WorkerTraceCapabilityDatabase = ProjectMetadataDatabase &
  DataPrivacyResolutionDatabase &
  ModelCostCatalogDatabase &
  MonitorCatalogDatabase;

/** The four read-side capability services, each the feature's own. */
export type WorkerTraceCapabilityServices = Readonly<{
  projects: ProjectMetadataService;
  dataPrivacy: DataPrivacyResolutionService;
  modelCosts: ModelCostCatalogService;
  monitors: MonitorCatalogService;
}>;
