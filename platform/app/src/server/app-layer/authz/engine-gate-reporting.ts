import { createLogger } from "@langwatch/observability";
import { setAuthzEngineGateFailureReporter } from "./engine-gate";
import { authzEngineGateReadFailuresTotal } from "./metrics";

/** The server installs diagnostics for failed compatibility migration reads. */
export function installAuthzEngineGateReporting(): void {
  const gateLogger = createLogger("langwatch:authz:engine-gate");
  setAuthzEngineGateFailureReporter(({ organizationId, error, ttlMs }) => {
    gateLogger.warn(
      { organizationId, error, ttlMs },
      "could not read the authz migration state; compatibility migration completion remains unknown until the cache expires",
    );
    authzEngineGateReadFailuresTotal.inc();
  });
}
