import { ApiKeyApi } from "@langwatch/api-key-contract";
import { AutomationApi } from "@langwatch/automation-contract";
import type { FeatureSetup } from "@langwatch/kernel";
import { LangyApi, type LangyKeyCaller } from "@langwatch/langy-contract";
import {
  PlatformHealthApi,
  type PlatformHealthApi as PlatformHealthApiContract,
  type PlatformHealthCheckName,
  type PlatformHealthQuery,
  type PlatformHealthReport,
  PLATFORM_HEALTH_CHECK_NAMES,
  type ProjectKeyedProbeRequest,
} from "@langwatch/platform-health-contract";
import { ProjectApi } from "@langwatch/project-contract";
import { ScenarioApi } from "@langwatch/scenario-contract";
import { SuiteApi } from "@langwatch/suite-contract";
import { fromDate } from "@langwatch/time";
import { WorkflowApi } from "@langwatch/workflow-contract";

import { HttpSubsystemProbeChannel } from "../channels/http/http.subsystem-probe.channel.ts";
import { LangyCanaryService } from "../services/langy-canary.service.ts";
import { PlatformHealthKeyService } from "../services/platform-health-key.service.ts";
import { PlatformHealthService } from "../services/platform-health.service.ts";
import { ProjectKeyedProbeService } from "../services/project-keyed-probe.service.ts";
import { ScenarioCanaryService } from "../services/scenario-canary.service.ts";
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
    apiKeys: ApiKeyApi,
    /** The scenario canary launches and reads one run as main's shared launcher did. */
    scenarios: ScenarioApi,
    /** The run plan the scenario canary is pointed at, by id or slug. */
    suites: SuiteApi,
    /** The Langy canary sends one greeting turn as the key's owner and awaits its settlement. */
    langy: LangyApi,
  };
  /** Both names are from the process's vocabulary; boot refuses by name. */
  static readonly reads = ["secrets", "publicBaseUrl"] as const;

  readonly #health: PlatformHealthService;
  readonly #key: PlatformHealthKeyService;
  readonly #projectKeyed: ProjectKeyedProbeService;
  readonly #langyCanary: LangyCanaryService;

  private constructor(services: {
    health: PlatformHealthService;
    key: PlatformHealthKeyService;
    projectKeyed: ProjectKeyedProbeService;
    langyCanary: LangyCanaryService;
  }) {
    this.#health = services.health;
    this.#key = services.key;
    this.#projectKeyed = services.projectKeyed;
    this.#langyCanary = services.langyCanary;
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
      findProjectIds: async (): Promise<string[]> => {
        const projectId = await dependencies.projects.findIdByLegacyApiKey({ token: probeApiKey });
        return projectId ? [projectId] : [];
      },
    };

    return new PlatformHealthApp({
      health: PlatformHealthService.create({
        probes: PLATFORM_HEALTH_CHECK_NAMES.map((name) =>
          SubsystemProbeAdapter.create({ name, probes, credential }),
        ),
      }),
      key: PlatformHealthKeyService.create({
        apiKey: members.secrets.find("PLATFORM_HEALTH_API_KEY") ?? "",
      }),
      projectKeyed: ProjectKeyedProbeService.create({
        probes,
        resolveProject: async (input) =>
          (await dependencies.apiKeys.findResolvedToken(input))?.project.id ?? null,
        scenarioCanary: ScenarioCanaryService.create({
          peers: { scenarios: dependencies.scenarios, suites: dependencies.suites },
        }),
      }),
      langyCanary: LangyCanaryService.create({ langy: dependencies.langy }),
    });
  }

  /** `/api/health/*`: one probe, run as the caller's own project key, answered in main's words. */
  probeWithProjectKey(request: ProjectKeyedProbeRequest): Promise<Response> {
    return this.#projectKeyed.probe(request);
  }

  /** `/api/health/langy`: one greeting turn as the key's owner, answered in main's words. */
  probeLangy(key: LangyKeyCaller): Promise<Response> {
    return this.#langyCanary.probe(key);
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
