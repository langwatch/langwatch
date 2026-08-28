import { createSecuritySpine, type SecuredAppPorts, type SecuritySpine } from "@langwatch/api";

import type {
  AppRestOrganizationVariables,
  AppRestProjectVariables,
} from "./app-rest.variables";

/**
 * Everything the REST composition needs from the process it runs in.
 *
 * Authentication reads API keys, sessions and role bindings out of a database,
 * and the two error envelopes are rendered by the application's own error
 * taxonomy. Neither belongs in a transport package, and neither can be
 * resolved here: the process that owns those substrates supplies them once.
 */
export type AppRestSecurityPorts = SecuredAppPorts;

/**
 * The three secured-app factories, already bound to one process's enforcement.
 *
 * Obtaining them is the ONLY way to build a `SecuredApp`, and this module
 * cannot produce them without the ports above — which is what makes a route
 * with no declared access policy impossible to construct rather than merely
 * discouraged.
 */
export type AppRestSecurity = SecuritySpine<
  AppRestProjectVariables,
  AppRestOrganizationVariables
>;

/**
 * Bind the secured-app builder to one process's authentication, logging,
 * tracing and error rendering.
 *
 * Called once, at composition time. A REST feature in this package takes the
 * result as an argument rather than importing a module-level singleton, so a
 * feature can be mounted into a second process (tests, the standalone API
 * process) against different enforcement without touching the feature.
 */
export function createAppRestSecurity(ports: AppRestSecurityPorts): AppRestSecurity {
  return createSecuritySpine<AppRestProjectVariables, AppRestOrganizationVariables>(ports);
}
