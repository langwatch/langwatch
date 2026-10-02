import {
  GRANT_ATTACHED_EVENT_TYPE,
  GRANT_REVOKED_EVENT_TYPE,
  GRANT_ROLE_CHANGED_EVENT_TYPE,
  ROLE_DEFINED_EVENT_TYPE,
  ROLE_DELETED_EVENT_TYPE,
  ROLE_PERMISSIONS_CHANGED_EVENT_TYPE,
  type AuthzGrantEventPayload,
  type PrincipalKind,
} from "@langwatch/authz-contract";
import { createLogger, type Logger } from "@langwatch/observability";

import type { AuthzManagedGrantRepository } from "../repositories/authz-managed-grant.repository.ts";
import type { AuthzSessionVersionRepository } from "../repositories/authz-session-version.repository.ts";

/** A key or a share link's audience is never a browser session, so its grant bumps no one. */
const SESSIONLESS_PRINCIPALS: ReadonlySet<PrincipalKind> = new Set(["apiKey", "project", "anyone"]);

/** Past this many principals on one role, its holders are not expanded: everyone is bumped. */
const ROLE_HOLDER_PRINCIPAL_LIMIT = 500;

/**
 * The per-user session version (ADR-170): read on every tRPC answer, bumped
 * for everyone whose access a grant event changed, after it has projected.
 */
export class AuthzSessionVersionService {
  static create(dependencies: {
    versions: AuthzSessionVersionRepository;
    bindings: AuthzManagedGrantRepository;
    logger?: Logger;
  }): AuthzSessionVersionService {
    return new AuthzSessionVersionService(
      dependencies.versions,
      dependencies.bindings,
      dependencies.logger ?? createLogger("langwatch:authz:session-version"),
    );
  }

  private constructor(
    private readonly versions: AuthzSessionVersionRepository,
    private readonly bindings: AuthzManagedGrantRepository,
    private readonly logger: Logger,
  ) {}

  getSessionVersion({ userId }: { userId: string }): Promise<number> {
    return this.versions.getVersion({ userId });
  }

  async bumpFor({
    organizationId,
    event,
  }: {
    organizationId: string;
    event: AuthzGrantEventPayload;
  }): Promise<void> {
    // Never miss a holder: a lookup that fails bumps the whole organization instead.
    const userIds = await this.affectedUserIds({ organizationId, event }).catch((error) => {
      this.logger.warn(
        {
          organizationId,
          eventType: event.type,
          roleId: "roleId" in event.data ? event.data.roleId : undefined,
          errorClass: error instanceof Error ? error.constructor.name : typeof error,
        },
        "could not find who a grant or role event reaches; bumping the whole organization",
      );
      return this.bindings.findOrganizationUserIds({ organizationId });
    });
    if (userIds.length > 0) await this.versions.bump({ userIds: [...new Set(userIds)] });
  }

  private async affectedUserIds({
    organizationId,
    event,
  }: {
    organizationId: string;
    event: AuthzGrantEventPayload;
  }): Promise<string[]> {
    switch (event.type) {
      case GRANT_ATTACHED_EVENT_TYPE:
        return this.holders({ organizationId, principal: event.data.principal });
      case GRANT_ROLE_CHANGED_EVENT_TYPE:
      case GRANT_REVOKED_EVENT_TYPE: {
        const grantId = event.data.grantId;
        const [found] = await this.bindings.findGrantPrincipals({
          organizationId,
          grantIds: [grantId],
        });
        // A grant that never projected granted nothing; bump everyone rather than guess.
        if (!found) return this.bindings.findOrganizationUserIds({ organizationId });
        return this.holders({ organizationId, principal: found.principal });
      }
      case ROLE_DEFINED_EVENT_TYPE:
      case ROLE_PERMISSIONS_CHANGED_EVENT_TYPE:
      case ROLE_DELETED_EVENT_TYPE:
        return this.roleHolders({ organizationId, roleId: event.data.roleId });
    }
  }

  /** Everyone a role's live grants reach, directly or through a group or team. */
  private async roleHolders({
    organizationId,
    roleId,
  }: {
    organizationId: string;
    roleId: string;
  }): Promise<string[]> {
    const principals = await this.bindings.findRoleHolderPrincipals({
      organizationId,
      roleId,
      limit: ROLE_HOLDER_PRINCIPAL_LIMIT + 1,
    });
    const idsOf = (type: PrincipalKind) =>
      principals.flatMap((principal) =>
        principal.type === type && principal.id !== null ? [principal.id] : [],
      );
    if (
      principals.length > ROLE_HOLDER_PRINCIPAL_LIMIT ||
      principals.some((principal) => principal.type === "organization")
    ) {
      return this.bindings.findOrganizationUserIds({ organizationId });
    }
    const [groupMembers, teamMembers] = await Promise.all([
      this.bindings.findGroupMembers({ organizationId, groupIds: idsOf("group") }),
      this.bindings.findTeamMembers({ organizationId, teamIds: idsOf("team") }),
    ]);
    return [...idsOf("user"), ...[...groupMembers, ...teamMembers].map((row) => row.userId)];
  }

  private async holders({
    organizationId,
    principal,
  }: {
    organizationId: string;
    principal: { type: PrincipalKind; id: string | null };
  }): Promise<string[]> {
    if (SESSIONLESS_PRINCIPALS.has(principal.type) || principal.id === null) return [];
    if (principal.type === "user") return [principal.id];
    if (principal.type === "group") {
      const members = await this.bindings.findGroupMembers({
        organizationId,
        groupIds: [principal.id],
      });
      return members.map((member) => member.userId);
    }
    if (principal.type === "team") {
      const members = await this.bindings.findTeamMembers({
        organizationId,
        teamIds: [principal.id],
      });
      return members.map((member) => member.userId);
    }
    return this.bindings.findOrganizationUserIds({ organizationId });
  }
}
