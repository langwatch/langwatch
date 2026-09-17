import type { DataPrivacyResolution } from "@langwatch/data-privacy-server";
import {
  PrismaModelCostCatalogRepository,
  type ModelCostCatalogDatabase,
  type ModelCostCatalogService,
} from "@langwatch/model-provider-server";
import type { MonitorApi } from "@langwatch/monitor-contract";
import type { ProjectApi } from "@langwatch/project-contract";

/**
 * The four read-side capabilities the record path reaches, each taken from the
 * ONE application this process installed. A second reading of any of them would
 * be a second answer: a project directory built beside the installed one
 * resolves an organization on its own, and a privacy resolution built beside it
 * decides a customer's redaction on its own.
 */
export function createWorkerTraceCapabilityServices(options: {
  database: WorkerTraceCapabilityDatabase;
  /**
   * The installed project application. `ProjectApi` is a strict superset of the
   * metadata reads this path makes, `getOrganizationId` included, so the cost
   * catalogue resolves its three scopes through the same directory the
   * interactive process resolves them through.
   */
  projects: ProjectApi;
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
  monitors: Pick<MonitorApi, "getEnabledOnMessageMonitors">;
}): WorkerTraceCapabilityServices {
  return {
    projects: options.projects,
    dataPrivacy: options.dataPrivacy,
    modelCosts: PrismaModelCostCatalogRepository.create({
      database: options.database,
      projects: options.projects,
    }).build(),
    monitors: options.monitors,
  };
}

/**
 * The Prisma models the cost catalogue reads, and nothing else in the client.
 * The declaration is the feature's own, so a model it starts reading arrives at
 * this seam by typecheck, not by review.
 */
export type WorkerTraceCapabilityDatabase = ModelCostCatalogDatabase;

/** The four read-side capability services, each the feature's own. */
export type WorkerTraceCapabilityServices = Readonly<{
  projects: ProjectApi;
  dataPrivacy: DataPrivacyResolution;
  modelCosts: ModelCostCatalogService;
  monitors: Pick<MonitorApi, "getEnabledOnMessageMonitors">;
}>;
