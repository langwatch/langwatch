/**
 * The monitoring-keyed platform-health family, installed over this process's
 * own probes. Nothing is structural: no monitoring key cannot tell a monitor
 * from anyone else, and no probe credential cannot author a canary.
 */
import type { PlatformHealthApi } from "@langwatch/platform-health-contract";
import { platformHealthServer } from "@langwatch/platform-health-server";
import { createApp } from "@langwatch/runtime-composition";
import { fromDate } from "@langwatch/time";

import type { HealthProbeRestPorts } from "../health/health-probe-rest.mount.ts";

/** What this process brings to the platform-health family. */
export type ApiPlatformHealthOptions = Readonly<{
  /** `PLATFORM_HEALTH_API_KEY`, blank-is-unconfigured. */
  apiKey: string | undefined;
  /** `PLATFORM_HEALTH_PROBE_API_KEY`, blank-is-unconfigured. */
  probeApiKey: string | undefined;
  /**
   * The SAME collaborators the project-keyed `/api/health/*` probes run on, so
   * the two doors cannot disagree about what a subsystem's health is.
   */
  probes: HealthProbeRestPorts | undefined;
}>;

/**
 * The platform-health application. `/api/v1/platform-health` is opened from the
 * door registry over it, never from here.
 */
export type ComposedPlatformHealthFeature = Readonly<{
  app: PlatformHealthApi;
}>;

/** Installs the platform-health surface over this process's own graph. */
export async function installApiPlatformHealth(
  options: ApiPlatformHealthOptions,
): Promise<ComposedPlatformHealthFeature | undefined> {
  const apiKey = options.apiKey?.trim();
  const probeApiKey = options.probeApiKey?.trim();
  const probes = options.probes;
  if (!apiKey || !probeApiKey || !probes) return undefined;

  const runtime = await createApp({ name: "langwatch-api" })
    .withInfrastructure({})
    .withModule(platformHealthServer, {
      infrastructure: {
        publicBaseUrl: probes.publicBaseUrl,
        automation: () => {
          const automation = probes.automation();

          return {
            findById: (input) => automation.tryGetById(input),
            getRecentFires: async (input) =>
              (await automation.getRecentFires(input)).map((fire) => ({
                firedAt: fromDate(fire.createdAt),
              })),
          };
        },
        workflowExists: (input) => probes.workflowExists(input),
        resolveProjectByApiKey: (token) => probes.resolveProjectByApiKey(token),
      },
    })
    .boot({ role: "api", config: { "platform-health": { apiKey, probeApiKey } } });

  const app = runtime.module(platformHealthServer).provided;

  return { app };
}
