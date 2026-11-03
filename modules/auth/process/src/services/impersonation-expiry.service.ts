import type { AuditLogApi } from "@langwatch/audit-log-contract";
import type { OrganizationApi } from "@langwatch/organization-contract";
import { type Instant, nowInstant } from "@langwatch/time";

import type {
  AuthSessionRepository,
  LapsedImpersonation,
} from "../repositories/auth-session.repository.ts";

export const IMPERSONATION_EXPIRED_ACTION = "admin/impersonate.expired";
/** How many lapsed windows one sweep settles; the next tick takes the rest. */
const SWEEP_BATCH = 100;

type ImpersonationExpiryDeps = Readonly<{
  sessions: Pick<AuthSessionRepository, "findLapsedImpersonations" | "clearLapsedImpersonation">;
  memberships: Pick<OrganizationApi, "organizationIdsForMember">;
  auditLog: Pick<AuditLogApi, "record" | "hasRecordedSince">;
  now: () => Instant;
}>;

/**
 * Audits impersonations that ended by running out rather than by a stop: one row per
 * organization the subject belongs to, operator as the actor, then the claims are cleared.
 * Spec: specs/identity/admin-impersonation.feature.
 */
export class ImpersonationExpiryService {
  private constructor(private readonly deps: ImpersonationExpiryDeps) {}

  static create({
    now = nowInstant,
    ...deps
  }: Omit<ImpersonationExpiryDeps, "now"> & { now?: () => Instant }): ImpersonationExpiryService {
    return new ImpersonationExpiryService({ ...deps, now });
  }

  /** Settles every lapsed window found; answers how many were cleared. */
  async sweep(): Promise<number> {
    const lapsed = await this.deps.sessions.findLapsedImpersonations({
      before: this.deps.now(),
      limit: SWEEP_BATCH,
    });
    let expired = 0;
    for (const window of lapsed) {
      await this.audit(window);
      if (await this.deps.sessions.clearLapsedImpersonation(window)) expired += 1;
    }
    return expired;
  }

  /** A retry after a failed clear finds each organization's row written and writes it once. */
  private async audit(window: LapsedImpersonation): Promise<void> {
    const { actorUserId, subjectUserId } = window;
    if (!actorUserId || !subjectUserId) return;
    const organizationIds = await this.deps.memberships.organizationIdsForMember({
      userId: subjectUserId,
    });
    const target = {
      userId: actorUserId,
      action: IMPERSONATION_EXPIRED_ACTION,
      targetKind: "session",
      targetId: window.sessionId,
    };
    const args = {
      userIdImpersonated: subjectUserId,
      reason: window.reason,
      expiredAt: window.expiresAt.toString(),
    };
    for (const organizationId of organizationIds.length > 0 ? organizationIds : [undefined]) {
      const scope = organizationId ? { organizationId } : {};
      const alreadyAudited = await this.deps.auditLog.hasRecordedSince({
        ...target,
        ...scope,
        sinceMs: window.expiresAt.epochMilliseconds,
      });
      if (alreadyAudited) continue;
      await this.deps.auditLog.record({ ...target, actorUserId, ...scope, args });
    }
  }
}
