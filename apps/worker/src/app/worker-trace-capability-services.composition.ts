import type { DataPrivacyResolution } from "@langwatch/data-privacy-server";
import {
  PrismaModelCostCatalogRepository,
  type ModelCostCatalogDatabase,
  type ModelCostCatalogService,
} from "@langwatch/model-provider-server";
import type { MonitorApi } from "@langwatch/monitor-contract";
import {
  PrismaProjectRepository,
  ProjectMetadataService,
  type ProjectDiagnostics,
  type ProjectMetadataDatabase,
} from "@langwatch/project-server";

/**
 * Staged but not mounted; the four capability services are now composable from
 * database.
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
  diagnostics?: ProjectDiagnostics;
  /**
   * The resolved privacy policy the record path redacts by. Taken rather than
   * built: the booted Data Privacy application is the one resolution this
   * process has, and a second would answer a different policy for one project.
   */
  dataPrivacy: DataPrivacyResolution;
  /**
   * The monitors enabled on every message. Taken rather than built: the ONE
   * monitor application this process installs answers the same listing the
   * evaluation trigger reads, and a second reading could disagree with it.
   */
  monitors: MonitorApi;
}): WorkerTraceCapabilityServices {
  const projects = ProjectMetadataService.create({
    repository: PrismaProjectRepository.create({ prisma: options.database }),
    ...(options.diagnostics ? { diagnostics: options.diagnostics } : {}),
  });

  return {
    projects,
    dataPrivacy: options.dataPrivacy,
    modelCosts: PrismaModelCostCatalogRepository.create({
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
  dataPrivacy: DataPrivacyResolution;
  modelCosts: ModelCostCatalogService;
  monitors: Pick<MonitorApi, "getEnabledOnMessageMonitors">;
}>;
