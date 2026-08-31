/**
 * This process's composition of the packaged organization management REST
 * family (`@langwatch/organization-server`).
 *
 * The family — the routes, the wire schemas, the handlers and the OpenAPI
 * declarations — lives in the feature package (ADR-128). What lives here is
 * everything it dispatches through that is this process's rather than the
 * organization feature's: the REST security spine, the Enterprise plan gate,
 * the invitation service and its acceptance link, the licence layer's seat
 * error, the organization-to-team role default, the trace-share revocation a
 * settings change triggers, and the audit sink.
 *
 * Built once at module scope, the way the family it replaced was: the app it
 * returns is mounted by `api-router.ts` and walked by the OpenAPI generator,
 * and every service it reaches is resolved per request off the Hono context,
 * so nothing here forces a service to be constructed at import time.
 */
import { createOrganizationRestApp } from "@langwatch/organization-server";

import { appFromContext } from "~/app/api/middleware/app-context";
import { requireEnterprisePlanRest } from "~/app/api/middleware/enterprise-gate";
import { managementAuditPort } from "~/server/api/management/audit";
import { revokeTraceSharesAfterOrganizationSettingsUpdate } from "~/server/api/ports/organization-settings.effects";
import { appRestSecurity } from "~/server/api/security";
import { MemberSeatLimitReachedError } from "~/server/app-layer/organizations/errors";
import { prisma } from "~/server/db";
import { buildInviteAcceptUrl } from "~/server/invites/invite-link";
import { InviteService } from "~/server/invites/invite.service";
import { LimitExceededError } from "~/server/license-enforcement/errors";
import { ORGANIZATION_TO_TEAM_ROLE_MAP } from "~/utils/memberRoleConstraints";

/**
 * The management surface's one wire code for "no seat left": the license
 * layer reports overflow as `resource_limit_exceeded`, which on this family
 * would make two member endpoints answer the same refusal under two names.
 */
function rethrowSeatLimit(error: unknown): never {
  if (error instanceof LimitExceededError) {
    throw new MemberSeatLimitReachedError({
      meta: {
        limitType: error.limitType,
        current: error.current,
        max: error.max,
      },
    });
  }
  throw error;
}

export const organizationRestApp = createOrganizationRestApp({
  security: appRestSecurity,
  enterpriseGate: requireEnterprisePlanRest("MANAGEMENT_API"),
  organizations: (context) => appFromContext(context).organizationService,
  // `InviteService.create` takes no base host: the acceptance link is built
  // from the deployment's own `BASE_HOST`, which is why the link builder below
  // is a one-argument function. The registration this replaced passed a
  // `baseHost` option the constructor does not declare, and passed the same
  // value as a second argument to the one-argument link builder; both were
  // ignored at runtime, and both are dropped here rather than carried.
  invites: () => InviteService.create(prisma),
  permissions: (context) => appFromContext(context).permissions,
  audit: managementAuditPort,
  ports: {
    rethrowSeatLimit,
    defaultTeamRoleFor: (role) => ORGANIZATION_TO_TEAM_ROLE_MAP[role],
    buildInviteAcceptUrl,
    onSettingsUpdated: (context, { organizationId, result }) =>
      revokeTraceSharesAfterOrganizationSettingsUpdate(
        appFromContext(context).share,
        appFromContext(context).projects.projectService,
        organizationId,
        result,
      ),
  },
});
