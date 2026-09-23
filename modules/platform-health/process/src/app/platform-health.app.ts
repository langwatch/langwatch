import { AutomationApi } from "@langwatch/automation-contract";
import type { FeatureSetup } from "@langwatch/kernel";
import {
  PlatformHealthApi,
  type PlatformHealthApi as PlatformHealthApiContract,
  type PlatformHealthCheckName,
  type PlatformHealthQuery,
  type PlatformHealthReport,
  PLATFORM_HEALTH_CHECK_NAMES,
} from "@langwatch/platform-health-contract";
import { ProjectApi } from "@langwatch/project-contract";
import { fromDate } from "@langwatch/time";
import { WorkflowApi } from "@langwatch/workflow-contract";

import { HttpSubsystemProbeChannel } from "../channels/http/http.subsystem-probe.channel.ts";
import { PlatformHealthKeyService } from "../services/platform-health-key.service.ts";
import { PlatformHealthService } from "../services/platform-health.service.ts";
import { SubsystemProbeAdapter } from "../services/subsystem-probe-run.service.ts";
import {
  SubsystemProbeService,
  type SubsystemProbeCollaborators,
} from "../services/subsystem-probe.service.ts";

export type PlatformHealthInfrastructure = SubsystemProbeCollaborators;

/**
 * Shapes restated rather than imported from `@langwatch/process-stores`: a
 * module depends on contracts. `publicBaseUrl` is the process's own fact,
 * drilled in — absent where the deployment named no `BASE_HOST`.
 */
type PlatformHealthMembers = Readonly<{
  secrets: Readonly<{ find(key: string): string | undefined }>;
  publicBaseUrl: string | undefined;
}>;

type PlatformHealthSetup = FeatureSetup<
  typeof PlatformHealthApp.dependencies,
  PlatformHealthMembers,
  undefined
>;

/** The process-owned platform-health capability. */
export class PlatformHealthApp implements PlatformHealthApiContract {
  static readonly contract = PlatformHealthApi;
  static readonly dependencies = {
    automation: AutomationApi,
    workflow: WorkflowApi,
    projects: ProjectApi,
  };
  /** Both names are from the process's vocabulary; boot refuses by name. */
  static readonly reads = ["secrets", "publicBaseUrl"] as const;

  readonly #health: PlatformHealthService;
  readonly #key: PlatformHealthKeyService;

  private constructor(health: PlatformHealthService, key: PlatformHealthKeyService) {
    this.#health = health;
    this.#key = key;
  }

  static create({ dependencies, members }: PlatformHealthSetup): PlatformHealthApp {
    const probeApiKey = members.secrets.find("PLATFORM_HEALTH_PROBE_API_KEY") ?? "";
    const collaborators: SubsystemProbeCollaborators = {
      canaries: HttpSubsystemProbeChannel.create({ publicBaseUrl: members.publicBaseUrl ?? "" }),
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
      PlatformHealthKeyService.create({
        apiKey: members.secrets.find("PLATFORM_HEALTH_API_KEY") ?? "",
      }),
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
