import { ApiKeyApi } from "@langwatch/api-key-contract";
import type { RestIdentity } from "@langwatch/api/hosting";
import { BearerIdentity } from "@langwatch/api/rest";
import { AutomationApi } from "@langwatch/automation-contract";
import { LangyApi, type LangyKeyCaller } from "@langwatch/langy-contract";
import {
  PlatformHealthApi,
  platformHealthConfig,
  type PlatformHealthServerConfig,
  type PlatformHealthApi as PlatformHealthApiContract,
  type PlatformHealthCheckName,
  type PlatformHealthCheckInput,
  type PlatformHealthReport,
  PLATFORM_HEALTH_CHECK_NAMES,
  type ProjectKeyedProbeRequest,
} from "@langwatch/platform-health-contract";
import type { FeatureSetup } from "@langwatch/process";
import { ProjectApi } from "@langwatch/project-contract";
import { ScenarioApi } from "@langwatch/scenario-contract";
import { Secret } from "@langwatch/secrets";
import { SuiteApi } from "@langwatch/suite-contract";
import { fromDate } from "@langwatch/time";
import { WorkflowApi } from "@langwatch/workflow-contract";

import { HttpSubsystemProbeChannel } from "../channels/http/http.subsystem-probe.channel.ts";
import { LangyCanaryService } from "../services/langy-canary.service.ts";
import { PlatformHealthService } from "../services/platform-health.service.ts";
import { ProjectKeyedProbeService } from "../services/project-keyed-probe.service.ts";
import { ScenarioCanaryService } from "../services/scenario-canary.service.ts";
import { SubsystemProbeRunService } from "../services/subsystem-probe-run.service.ts";
import {
  SubsystemProbeService,
  type SubsystemProbeCollaborators,
} from "../services/subsystem-probe.service.ts";

export type PlatformHealthInfrastructure = SubsystemProbeCollaborators;

type PlatformHealthSetup = FeatureSetup<
  typeof PlatformHealthModule.dependencies,
  never,
  PlatformHealthServerConfig
>;

/** The process-owned platform-health capability. */
export class PlatformHealthModule implements PlatformHealthApiContract {
  static readonly contract = PlatformHealthApi;
  static readonly config = platformHealthConfig;
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
  static readonly secrets = {
    probeApiKey: Secret.load("PLATFORM_HEALTH_PROBE_API_KEY", { optional: true }),
    apiKey: Secret.load("PLATFORM_HEALTH_API_KEY", { optional: true }),
  };

  readonly #health: PlatformHealthService;
  readonly #monitorDoor: RestIdentity;
  readonly #projectKeyed: ProjectKeyedProbeService;
  readonly #langyCanary: LangyCanaryService;

  private constructor(services: {
    health: PlatformHealthService;
    monitorDoor: RestIdentity;
    projectKeyed: ProjectKeyedProbeService;
    langyCanary: LangyCanaryService;
  }) {
    this.#health = services.health;
    this.#monitorDoor = services.monitorDoor;
    this.#projectKeyed = services.projectKeyed;
    this.#langyCanary = services.langyCanary;
  }

  static async create({
    dependencies,
    config,
    secrets,
  }: PlatformHealthSetup): Promise<PlatformHealthModule> {
    const probeApiKey = await secrets.into(
      PlatformHealthModule.secrets.probeApiKey,
      (value) => value ?? "",
    );
    const monitorDoor = await secrets.into(PlatformHealthModule.secrets.apiKey, (token) =>
      BearerIdentity.create({ name: "platform-health", token }),
    );
    const collaborators: SubsystemProbeCollaborators = {
      canaries: HttpSubsystemProbeChannel.create({ publicBaseUrl: config.publicBaseUrl ?? "" }),
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

    return new PlatformHealthModule({
      health: PlatformHealthService.create({
        probes: PLATFORM_HEALTH_CHECK_NAMES.map((name) =>
          SubsystemProbeRunService.create({ name, probes, credential }),
        ),
      }),
      monitorDoor,
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

  checkAll(query: PlatformHealthCheckInput): Promise<PlatformHealthReport> {
    return this.#health.checkAll(query);
  }

  checkOne(
    name: PlatformHealthCheckName,
    query: PlatformHealthCheckInput,
  ): Promise<PlatformHealthReport> {
    return this.#health.checkOne(name, query);
  }

  /**
   * The monitoring family's door: the deployment's key as a bearer. Unset, the
   * family answers 404 as though it were not there; blank, it answers 500.
   */
  get monitorDoor(): RestIdentity {
    return this.#monitorDoor;
  }
}
