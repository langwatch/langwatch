/**
 * This process's composition of the packaged organization management REST
 * family (`@langwatch/organization-server`).
 *
 * The family — the routes, the wire schemas, the handlers and the OpenAPI
 * declarations — lives in the feature package (ADR-128). What lives here is
 * everything it dispatches through that is this process's rather than the
 * organization feature's: the Enterprise plan gate over the whole family, the
 * organization-to-team role default, the seat-limit rename, the trace-share
 * revocation a settings change triggers, and the audit sink.
 *
 * The invitation half is a NAMED ABSENCE. `InviteService` reaches the licence
 * enforcement repository, the plan provider, the mailer and the role service —
 * four verticals that have not moved — so the three invitation routes refuse
 * with `service_unavailable` naming the capability. An empty invitation list
 * would tell an administrator nobody had been invited, which is the one answer
 * they act on by inviting the same person twice.
 */
import type { AuthzService } from "@langwatch/authz-contract";
import type { AppRestManagementAuditPort, AppRestSecurity, MountableRestApp } from "@langwatch/api/rest";
import { createEnterprisePlanGate } from "@langwatch/enterprise-plan-gate";
import { HandledError } from "@langwatch/handled-error";
import {
  createOrganizationRestApp,
  MemberSeatLimitReachedError,
  ORGANIZATION_TO_TEAM_ROLE_MAP,
  type OrganizationRestInviteService,
  type OrganizationRestService,
} from "@langwatch/organization-server";
import type { PlanProvider } from "@langwatch/entitlement-contract";
import type { ProjectService } from "@langwatch/project-contract";
import type { ShareService } from "@langwatch/share-contract";

import { ApiRestCapabilityUnavailableError } from "../../app/api-rest-ports";
import { revokeTraceSharesAfterOrganizationSettingsUpdate } from "./organization-settings.effects";

/** `/api/organization`, bound to one process's organization graph. */
export function mountOrganizationRest(options: {
  security: AppRestSecurity;
  organizations: () => OrganizationRestService;
  permissions: () => AuthzService;
  plans: () => PlanProvider;
  shares: () => ShareService;
  projects: () => ProjectService;
  audit: AppRestManagementAuditPort;
  /** Where the deployment composed an invitation service; absent refuses by name. */
  invites?: (() => OrganizationRestInviteService) | undefined;
  /** The acceptance link an invite carries, where a service mints them. */
  buildInviteAcceptUrl?: ((inviteCode: string) => string) | undefined;
}): MountableRestApp {
  const enterprisePlanGate = createEnterprisePlanGate({
    organization: (context) => context.get("organization") as { id: string } | undefined,
    plans: () => options.plans(),
  });

  const invites = options.invites ?? (() => unavailableInvites());

  return createOrganizationRestApp({
    security: options.security,
    enterpriseGate: enterprisePlanGate("MANAGEMENT_API"),
    organizations: () => options.organizations(),
    invites: () => invites(),
    permissions: () => options.permissions(),
    audit: options.audit,
    ports: {
      rethrowSeatLimit,
      defaultTeamRoleFor: (role) => ORGANIZATION_TO_TEAM_ROLE_MAP[role],
      buildInviteAcceptUrl:
        options.buildInviteAcceptUrl ??
        (() => {
          throw new ApiRestCapabilityUnavailableError("organization invitation service");
        }),
      onSettingsUpdated: (_context, { organizationId, result }) =>
        revokeTraceSharesAfterOrganizationSettingsUpdate(
          options.shares(),
          options.projects(),
          organizationId,
          result,
        ),
    },
  });
}

/**
 * The management surface's one wire code for "no seat left".
 *
 * Matched on the handled CODE rather than on the licence layer's error class:
 * that class lives in `platform/app/src/server/license-enforcement`, a tree
 * this migration only deletes from, and a code comparison is what the repo
 * asks for anywhere an error may have crossed a serialisation boundary. The
 * rename exists because the licence layer reports overflow as
 * `resource_limit_exceeded`, which on this family would make two member
 * endpoints answer the same refusal under two names.
 */
function rethrowSeatLimit(error: unknown): never {
  if (HandledError.isHandled(error) && error.code === "resource_limit_exceeded") {
    throw new MemberSeatLimitReachedError({
      meta: error.meta as { limitType: string; current: number; max: number },
    });
  }
  throw error;
}

/** Every invitation operation, refusing by name on a process with no service. */
function unavailableInvites(): OrganizationRestInviteService {
  const refuse = (): never => {
    throw new ApiRestCapabilityUnavailableError("organization invitation service");
  };
  return {
    listInvites: refuse,
    createInvites: refuse,
    revokeInvite: refuse,
  };
}
