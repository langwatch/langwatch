/**
 * Binds the `organization-management` REST declaration
 * (`@langwatch/organization-server`) to this process's organization door.
 *
 * The family - the routes, the wire schemas, the handlers, the OpenAPI
 * declarations, and the orchestration that used to cross a feature boundary
 * (trace-share revocation, the invite acceptance link, the authorization
 * feature's access breakdown) - lives in the application now. What lives here
 * is only this process's own concerns: the Enterprise plan gate over the
 * whole family and the management audit trail.
 */
import { EnterprisePlanRequiredError, isEnterpriseTier } from "@langwatch/enterprise-plan-gate";
import type { PlanProvider } from "@langwatch/entitlement-contract";
import type { OrganizationApi } from "@langwatch/organization-contract";
import type { AppRestManagementAudit, MountableRestApp } from "@langwatch/api/rest";
import { bindRestMiddleware } from "@langwatch/api/rest";
import { organizationManagementEnterpriseGate, organizationManagementRest } from "@langwatch/organization-server";
import type { MiddlewareHandler } from "hono";

import type { ApiRestRuntime } from "../../app-rest/api-rest.runtime.ts";

/** A dated or `latest` path segment, which addresses no resource. */
const VERSION_SEGMENT = /^(latest|20\d{2}-\d{2}-\d{2})$/;

/** What this mount needs to bind the family's one process fact. */
export type OrganizationManagementRestOptions = Readonly<{
  organizations: () => OrganizationApi;
  plans: () => PlanProvider;
  audit: AppRestManagementAudit;
}>;

/** Mounts `/api/organization` behind this process's organization credential. */
export function mountOrganizationManagementRest(
  runtime: ApiRestRuntime,
  options: OrganizationManagementRestOptions,
): MountableRestApp {
  return runtime.mount(organizationManagementRest.router(), options.organizations, {
    facts: [
      bindRestMiddleware(organizationManagementEnterpriseGate, async (context) => {
        const { organizationId } = runtime.organizationCredentialOf(context.req.raw);
        const plan = await options.plans().getActivePlan({ organizationId });

        if (!isEnterpriseTier(plan.type)) throw new EnterprisePlanRequiredError("MANAGEMENT_API");

        return {};
      }),
    ],
    middleware: [recordOrganizationManagementAudit(runtime, options.audit)],
  });
}

/**
 * Emitted after the answer, and only for one that succeeded: a refusal
 * disclosed nothing and changed nothing, so recording it would report a write
 * that never happened. Only the member routes carried a distinct per-route
 * action before conversion; the profile and invite routes reuse the same
 * naming scheme by resource and verb.
 */
function recordOrganizationManagementAudit(
  runtime: ApiRestRuntime,
  audit: AppRestManagementAudit,
): MiddlewareHandler {
  return async (context, next) => {
    await next();

    if (context.res.status < 200 || context.res.status >= 300) return;

    const credential = runtime.organizationCredentialOf(context.req.raw);
    const userId = credential.userId ?? `apikey:${credential.apiKeyId}`;
    const action = actionOf(context.req.method, context.req.path);

    if (!action) return;

    audit({
      userId,
      organizationId: credential.organizationId,
      action,
      args: { addressed: addressedResourceId(context.req.path) },
    });
  };
}

/** The `management.<resource>.<verb>` action this request performed, if any. */
function actionOf(
  method: string,
  path: string,
): `management.${string}.${string}` | null {
  const segments = path.split("/").filter((segment) => segment.length > 0 && !VERSION_SEGMENT.test(segment));
  const namespace = segments.indexOf("organization");
  const rest = namespace < 0 ? [] : segments.slice(namespace + 1);

  if (rest.length === 0 && method === "PATCH") return "management.organization.update";
  if (rest[0] === "members" && rest.length === 1 && method === "GET") {
    return "management.organizationMember.list";
  }
  if (rest[0] === "members" && rest.length === 3 && rest[2] === "access" && method === "GET") {
    return "management.organizationMember.readAccess";
  }
  if (rest[0] === "members" && rest.length === 2 && method === "GET") {
    return "management.organizationMember.read";
  }
  if (rest[0] === "members" && rest.length === 2 && method === "PATCH") return "management.member.update";
  if (rest[0] === "members" && rest.length === 2 && method === "DELETE") return "management.member.delete";
  if (rest[0] === "invites" && rest.length === 1 && method === "GET") return "management.invite.list";
  if (rest[0] === "invites" && rest.length === 1 && method === "POST") return "management.invite.create";
  if (rest[0] === "invites" && rest.length === 2 && method === "DELETE") return "management.invite.delete";

  return null;
}

/** The user id or invite id this request addressed, or none for the collection. */
function addressedResourceId(path: string): string | null {
  const segments = path.split("/").filter((segment) => segment.length > 0 && !VERSION_SEGMENT.test(segment));
  const namespace = segments.indexOf("organization");
  const rest = namespace < 0 ? [] : segments.slice(namespace + 1);

  return rest.length >= 2 ? (rest[1] ?? null) : null;
}
