/**
 * This process's composition of the monitoring-keyed platform-health family
 * (`@langwatch/platform-health-server`).
 */
import { PlatformHealthApp, type PlatformHealthRestPorts } from "@langwatch/platform-health-server";
import type { ResourceOwnership } from "@langwatch/runtime-composition";
import { fromDate } from "@langwatch/time";

import type { HealthProbeRestPorts } from "../health/health-probe-rest.ts";

/** What this process brings to the platform-health family. */
export type ApiPlatformHealthRestOptions = Readonly<{
  /** `PLATFORM_HEALTH_API_KEY`, blank-is-unconfigured. */
  apiKey: string | undefined;
  /** `PLATFORM_HEALTH_PROBE_API_KEY`, blank-is-unconfigured. */
  probeApiKey: string | undefined;
  /**
   * The SAME collaborators the project-keyed `/api/health/*` probes run on, so
   * the two doors cannot disagree about what a subsystem's health is.
   */
  probes: HealthProbeRestPorts | undefined;
  resources: ResourceOwnership;
}>;

/**
 * Composes the family, or answers nothing. Nothing is structural: no
 * monitoring key cannot tell a monitor from anyone else, no probe credential
 * cannot author a canary, and no collaborators have no boundary to dial.
 */
export function composeApiPlatformHealthRest(
  options: ApiPlatformHealthRestOptions,
): PlatformHealthRestPorts | undefined {
  const apiKey = options.apiKey?.trim();
  const probeApiKey = options.probeApiKey?.trim();
  const probes = options.probes;
  if (!apiKey || !probeApiKey || !probes) return undefined;

  const app = PlatformHealthApp.create({
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
    config: { apiKey, probeApiKey },
    dependencies: {},
    resources: options.resources,
  });

  return { platformHealth: () => app };
}
