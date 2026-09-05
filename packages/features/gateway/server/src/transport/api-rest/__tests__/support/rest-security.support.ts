/**
 * REST security spine for the families in this directory, supplying only the framework parts every SecuredApp needs (context, logging, tracing, error renderers). Credential chain is whatever the caller passes — internal control plane carries its own HMAC and needs none, spend family is driven with organization-installing middleware. Anything not supplied throws, so a family leaning on an unsupported check fails loudly.
 */
import { createAppRestSecurity, type AppRestSecurity } from "@langwatch/api/rest";
import type { ErrorHandler, MiddlewareHandler } from "hono";

const passThrough: MiddlewareHandler = async (_c, next) => {
  await next();
};

/** Nothing here is expected to throw, so a failure must be legible. */
const renderUnexpected: ErrorHandler = (error, c) =>
  c.json(
    { error: { type: "internal_error", code: "internal_error", message: String(error) } },
    500,
  );

export function testRestSecurity(options?: {
  organizationAuth?: MiddlewareHandler;
  organizationPermission?: MiddlewareHandler;
  canonicalErrorHandler?: ErrorHandler;
}): AppRestSecurity {
  const unreachable = () => {
    throw new Error("this family must not reach the framework credential chain");
  };
  const orgAuth = options?.organizationAuth;
  const orgPermission = options?.organizationPermission;
  const canonical = options?.canonicalErrorHandler ?? renderUnexpected;
  return createAppRestSecurity({
    appContext: passThrough,
    requestLogger: () => passThrough,
    requestTracer: () => passThrough,
    legacyErrorHandler: renderUnexpected,
    canonicalErrorHandler: canonical,
    authenticateProject: unreachable,
    authorizeProjectPermission: unreachable,
    authorizeApiKeyCeiling: unreachable,
    authenticateOrganization: orgAuth ? () => orgAuth : unreachable,
    authorizeOrganizationPermission: orgPermission ? () => orgPermission : unreachable,
    authorizeRouteTeamPermission: unreachable,
    authorizeRouteProjectPermission: unreachable,
    authenticateOrganizationThrowing: orgAuth ?? passThrough,
    authorizeOrganizationPermissionThrowing: unreachable,
  } as never);
}
