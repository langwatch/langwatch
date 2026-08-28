import {
  createRestApiService,
  type RestApiService,
  type RestApiServicePorts,
} from "./security/rest-api-service.js";

import type { AppRestOrganizationVariables, AppRestProjectVariables } from "./variables.js";

/**
 * Everything the REST composition needs from the process it runs in.
 *
 * Authentication reads API keys, sessions and role bindings out of a database,
 * and the two error envelopes are rendered by the application's own error
 * taxonomy. Neither belongs in a transport package, and neither can be
 * resolved here: the process that owns those substrates supplies them once.
 */
export type AppRestSecurityPorts = RestApiServicePorts;

/**
 * Every REST family factory, already bound to one process's enforcement.
 *
 * Obtaining it is the ONLY way to build a `SecuredApp` or a versioned family,
 * and this module cannot produce it without the ports above — which is what
 * makes a route with no declared access policy impossible to construct rather
 * than merely discouraged.
 */
export type AppRestSecurity = RestApiService<AppRestProjectVariables, AppRestOrganizationVariables>;

/**
 * Bind the REST service builder to one process's authentication, logging,
 * tracing and error rendering.
 *
 * Called once, at composition time. A REST feature takes the
 * result as an argument rather than importing a module-level singleton, so a
 * feature can be mounted into a second process (tests, the standalone API
 * process) against different enforcement without touching the feature.
 */
export function createAppRestSecurity(ports: AppRestSecurityPorts): AppRestSecurity {
  return createRestApiService<AppRestProjectVariables, AppRestOrganizationVariables>(ports);
}
