/**
 * Binds the monitoring-keyed platform-health declaration to this process. The
 * family resolves no credential — a monitor is not a tenant — so the route
 * compares this deployment's key itself.
 */
import { createErrorHandler } from "@langwatch/api";
import { bindRestHeader, type MountableRestApp, type RestErrorHandler } from "@langwatch/api/rest";
import {
  type PlatformHealthApi,
  PlatformHealthSubsystemNotFoundError,
  PlatformHealthUnhealthyError,
} from "@langwatch/platform-health-contract";
import { platformHealthAuthorization, platformHealthRest } from "@langwatch/platform-health-server";

import type { ApiRestRuntime } from "../../app-rest/api-rest.runtime.ts";

/** `/api/v1/platform-health` and `/api/v1/platform-health/:check`. */
export function mountPlatformHealthRest(
  runtime: ApiRestRuntime,
  platformHealth: () => PlatformHealthApi,
): MountableRestApp {
  return runtime.mount(platformHealthRest.router(), platformHealth, {
    onError: platformHealthErrors,
    facts: [bindRestHeader(platformHealthAuthorization, "authorization")],
  });
}

const canonicalErrors = createErrorHandler();

/**
 * A failing platform answers its report at 503, and an unknown subsystem the
 * sentence this family has always answered; every other refusal, the monitoring
 * key's included, is the canonical envelope.
 */
const platformHealthErrors: RestErrorHandler = (error, context) => {
  if (error instanceof PlatformHealthUnhealthyError) return context.json(error.report, 503);

  if (error instanceof PlatformHealthSubsystemNotFoundError) {
    return context.json({ message: error.message }, 404);
  }

  return canonicalErrors(error, context);
};
