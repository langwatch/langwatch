import { createLogger } from "@langwatch/observability";
import { setAuthzEngineGateFailureReporter } from "./engine-gate";
import { authzEngineGateReadFailuresTotal } from "./metrics";

/**
 * Give the authz engine gate its failure reporting.
 *
 * The gate itself cannot log or count: `rbac.ts` imports it and the browser
 * imports `rbac.ts`, so a module-scope pino logger or prom-client counter
 * there kills the client bundle at import time. It therefore ships with a
 * no-op reporter and the server installs this one at composition
 * (`presets.ts`) — which is the only reason a reopened legacy-fallback window
 * is visible at all. `engine-gate-reporting.unit.test.ts` pins what the
 * installed reporter does; `engine-gate-browser-safety.unit.test.ts` pins
 * that the composition installs it.
 */
export function installAuthzEngineGateReporting(): void {
  const gateLogger = createLogger("langwatch:authz:engine-gate");
  setAuthzEngineGateFailureReporter(({ organizationId, error, ttlMs }) => {
    gateLogger.warn(
      { organizationId, error, ttlMs },
      "could not read the authz migration state; this organization stays on the legacy path until the cache expires",
    );
    authzEngineGateReadFailuresTotal.inc();
  });
}
