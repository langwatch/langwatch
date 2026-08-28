/**
 * The application's secured-app composition.
 *
 * The builder, the access-policy vocabulary and the route-policy registry live
 * in `@langwatch/platform-api/app-rest`; import those from there. What cannot
 * live there is the enforcement itself — authentication reads API keys,
 * sessions and role bindings out of this application's database, and the two
 * error envelopes are rendered by this application's error taxonomy. Those
 * reach the composition as ports, supplied here, once.
 *
 * Binding them at composition time rather than registering them globally is
 * what makes an unenforced route impossible to build: the only way to obtain
 * `createProjectApp` / `createOrgApp` / `createServiceApp` is to import them
 * from this module, and this module cannot produce them without the ports.
 */
import { type AppRestSecurity, createAppRestSecurity } from "@langwatch/platform-api/app-rest";

import { appContextMiddleware } from "~/app/api/middleware/app-context";
import {
  authMiddleware,
  canonicalAuthMiddleware,
  requirePermission,
} from "~/app/api/middleware/auth";
import { handleError } from "~/app/api/middleware/error-handler";
import { loggerMiddleware } from "~/app/api/middleware/logger";
import {
  canonicalOrgAuthMiddleware,
  orgAuthMiddleware,
  requireOrgPermission,
  requireProjectPermission,
} from "~/app/api/middleware/org-auth";
import { tracerMiddleware } from "~/app/api/middleware/tracer";
import { canonicalErrorResponse } from "~/app/api/shared/canonical-error";
import { requireApiKeyPermission } from "~/server/api-key/auth-middleware";

/**
 * One authentication middleware per envelope, resolved from a table rather
 * than built per call: each one builds its own token resolver once, and the
 * envelope a family publishes is fixed for the life of the family.
 */
const PROJECT_AUTH = {
  legacy: authMiddleware,
  canonical: canonicalAuthMiddleware,
} as const;

const ORGANIZATION_AUTH = {
  legacy: orgAuthMiddleware,
  canonical: canonicalOrgAuthMiddleware,
} as const;

/**
 * This process's REST security, bound to this process's enforcement.
 *
 * A REST family that lives in `@langwatch/platform-api` takes this as an
 * argument rather than importing a spine of its own, so the mount decides
 * which enforcement a family runs under and the family stays free of the
 * application's database.
 */
export const appRestSecurity: AppRestSecurity = createAppRestSecurity({
  appContext: appContextMiddleware,
  requestLogger: loggerMiddleware,
  requestTracer: tracerMiddleware,
  legacyErrorHandler: handleError,
  canonicalErrorHandler: canonicalErrorResponse,

  authenticateProject: (envelope) => PROJECT_AUTH[envelope],
  authorizeProjectPermission: ({ permission, envelope }) =>
    requirePermission(permission, envelope),
  authorizeApiKeyCeiling: ({ permission, envelope }) =>
    requireApiKeyPermission({ permission, errorEnvelope: envelope }),

  authenticateOrganization: (envelope) => ORGANIZATION_AUTH[envelope],
  authorizeOrganizationPermission: ({ permission, envelope }) =>
    requireOrgPermission(permission, envelope),
  authorizeRouteProjectPermission: ({ permission, param, envelope }) =>
    requireProjectPermission({ permission, param, errorEnvelope: envelope }),
});

export const createProjectApp = appRestSecurity.createProjectApp;
export const createOrgApp = appRestSecurity.createOrgApp;
export const createServiceApp = appRestSecurity.createServiceApp;
