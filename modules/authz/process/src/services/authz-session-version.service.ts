import {
  GRANT_ATTACHED_EVENT_TYPE,
  GRANT_REVOKED_EVENT_TYPE,
  GRANT_ROLE_CHANGED_EVENT_TYPE,
  type AuthzGrantEventPayload,
  type PrincipalKind,
} from "@langwatch/authz-contract";

import type { AuthzBindingRepository } from "../repositories/authz-binding.repository.ts";
import type { AuthzSessionVersionRepository } from "../repositories/authz-session-version.repository.ts";

/** A key or a share link's audience is never a browser session, so its grant bumps no one. */
const SESSIONLESS_PRINCIPALS: ReadonlySet<PrincipalKind> = new Set(["apiKey", "project", "anyone"]);

/**
 * The per-user session version (ADR-164): read on every tRPC answer, bumped
 * for everyone whose access a grant event changed, after it has projected.
 */
export class AuthzSessionVersionService {
  static create(dependencies: {
    versions: AuthzSessionVersionRepository;
    bindings: AuthzBindingRepository;
  }): AuthzSessionVersionService {
    return new AuthzSessionVersionService(dependencies.versions, dependencies.bindings);
  }

  private constructor(
    private readonly versions: AuthzSessionVersionRepository,
    private readonly bindings: AuthzBindingRepository,
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
    const userIds = await this.affectedUserIds({ organizationId, event });
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
      default:
        // Role events name no holder: everyone in the organization may hold the role.
        return this.bindings.findOrganizationUserIds({ organizationId });
    }
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
    return this.bindings.findOrganizationUserIds({ organizationId });
  }
}
