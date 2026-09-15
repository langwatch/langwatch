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
import type { FeatureSetup } from "@langwatch/runtime-composition";
import type { Instant } from "@langwatch/time";

import { SubsystemProbeAdapter } from "../services/subsystem-probe-run.service.ts";
import { PlatformHealthKeyService } from "../services/platform-health-key.service.ts";
import { PlatformHealthService } from "../services/platform-health.service.ts";
import { SubsystemProbeService } from "../services/subsystem-probe.service.ts";

/**
 * The technical collaborators the probes reach: this deployment's public
 * origin, and the two lookups the trigger and workflow probes read.
 */
export type PlatformHealthInfrastructure = Readonly<{
  publicBaseUrl: string;
  automation(): Readonly<{
    findById(input: { triggerId: string; projectId: string }): Promise<unknown | null>;
    getRecentFires(input: {
      projectId: string;
      triggerId: string;
      limit: number;
    }): Promise<ReadonlyArray<{ firedAt: Instant }>>;
  }>;
  workflowExists(input: { workflowId: string; projectId: string }): Promise<boolean>;
  resolveProjectByApiKey(token: string): Promise<{ id: string } | null>;
}>;

type PlatformHealthSetup = FeatureSetup<
  typeof PlatformHealthApp.dependencies,
  PlatformHealthInfrastructure,
  PlatformHealthServerConfig
>;

/** The process-owned platform-health capability. */
export class PlatformHealthApp implements PlatformHealthApiContract {
  static readonly contract = PlatformHealthApi;
  static readonly dependencies = {};
  static readonly configSchema = platformHealthServerConfigSchema;

  readonly #health: PlatformHealthService;
  readonly #key: PlatformHealthKeyService;

  private constructor(health: PlatformHealthService, key: PlatformHealthKeyService) {
    this.#health = health;
    this.#key = key;
  }

  static create({ members, config }: PlatformHealthSetup): PlatformHealthApp {
    const probeApiKey = config.probeApiKey ?? "";
    const probes = SubsystemProbeService.create({ collaborators: members });
    const credential = {
      authToken: probeApiKey,
      resolveProjectId: async (): Promise<string | null> =>
        (await members.resolveProjectByApiKey(probeApiKey))?.id ?? null,
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
