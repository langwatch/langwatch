import {
  PlatformHealthApi,
  type PlatformHealthApi as PlatformHealthApiContract,
  type PlatformHealthCheckName,
  type PlatformHealthQuery,
  type PlatformHealthReport,
  type PlatformHealthServerConfig,
  PLATFORM_HEALTH_CHECK_NAMES,
  platformHealthServerConfigSchema,
} from "@langwatch/platform-health-contract";
import { AutomationApi } from "@langwatch/automation-contract";
import type { FeatureSetup } from "@langwatch/kernel";
import { ProjectApi } from "@langwatch/project-contract";
import { fromDate } from "@langwatch/time";
import { WorkflowApi } from "@langwatch/workflow-contract";

import { SubsystemProbeAdapter } from "../services/subsystem-probe-run.service.ts";
import { PlatformHealthKeyService } from "../services/platform-health-key.service.ts";
import { PlatformHealthService } from "../services/platform-health.service.ts";
import { SubsystemProbeService, type SubsystemProbeCollaborators } from "../services/subsystem-probe.service.ts";

export type PlatformHealthInfrastructure = SubsystemProbeCollaborators;

type PlatformHealthSetup = FeatureSetup<
  typeof PlatformHealthApp.dependencies,
  never,
  PlatformHealthServerConfig
>;

/** The process-owned platform-health capability. */
export class PlatformHealthApp implements PlatformHealthApiContract {
  static readonly contract = PlatformHealthApi;
  static readonly dependencies = {
    automation: AutomationApi,
    workflow: WorkflowApi,
    projects: ProjectApi,
  };
  static readonly configSchema = platformHealthServerConfigSchema;

  readonly #health: PlatformHealthService;
  readonly #key: PlatformHealthKeyService;

  private constructor(health: PlatformHealthService, key: PlatformHealthKeyService) {
    this.#health = health;
    this.#key = key;
  }

  static create({ dependencies, config }: PlatformHealthSetup): PlatformHealthApp {
    const probeApiKey = config.probeApiKey ?? "";
    const collaborators: SubsystemProbeCollaborators = {
      publicBaseUrl: config.publicBaseUrl ?? "",
      automation: () => ({
        findById: (input) => dependencies.automation.findById(input),
        getRecentFires: async (input) =>
          (await dependencies.automation.getRecentFires(input)).map((fire) => ({
            firedAt: fromDate(fire.createdAt),
          })),
      }),
      workflowExists: async (input) =>
        (await dependencies.workflow.findWorkflowFlags(input)) !== null,
    };
    const probes = SubsystemProbeService.create({ collaborators });
    const credential = {
      authToken: probeApiKey,
      resolveProjectId: async (): Promise<string | null> =>
        dependencies.projects.findIdByLegacyApiKey({ token: probeApiKey }),
    };

    return new PlatformHealthApp(
      PlatformHealthService.create({
        probes: PLATFORM_HEALTH_CHECK_NAMES.map((name) =>
          SubsystemProbeAdapter.create({ name, probes, credential }),
        ),
      }),
      PlatformHealthKeyService.create({ apiKey: config.apiKey ?? "" }),
    );
  }

  checkAll(query: PlatformHealthQuery): Promise<PlatformHealthReport> {
    return this.#health.checkAll(query);
  }

  checkOne(
    name: PlatformHealthCheckName,
    query: PlatformHealthQuery,
  ): Promise<PlatformHealthReport> {
    return this.#health.checkOne(name, query);
  }

  acceptsKey(presented: string | null | undefined): boolean {
    return this.#key.accepts(presented);
  }
}
