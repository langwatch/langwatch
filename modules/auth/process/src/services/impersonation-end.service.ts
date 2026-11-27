import type { AuditLogApi } from "@langwatch/audit-log-contract";
import { IMPERSONATION_WINDOW_MS, type SessionImpersonation } from "@langwatch/auth-contract";
import type { OrganizationApi } from "@langwatch/organization-contract";
import { type Instant, nowInstant, Temporal } from "@langwatch/time";

import type {
  AuthSessionRepository,
  LapsedImpersonation,
} from "../repositories/auth-session.repository.ts";

export const IMPERSONATION_STARTED_ACTION = "admin/impersonate";
export const IMPERSONATION_STOPPED_ACTION = "admin/impersonate.stop";
export const IMPERSONATION_EXPIRED_ACTION = "admin/impersonate.expired";
/** How many lapsed windows one sweep settles; the next tick takes the rest. */
const SWEEP_BATCH = 100;
/** Room for the clock that stamped the start rows to differ from ours. */
const START_ROW_SKEW_MS = 60 * 1_000;

type ImpersonationEndDeps = Readonly<{
  sessions: Pick<
    AuthSessionRepository,
    | "findById"
    | "writeImpersonation"
    | "clearImpersonation"
    | "findLapsedImpersonations"
    | "clearLapsedImpersonation"
  >;
  memberships: Pick<OrganizationApi, "organizationIdsForMember">;
  auditLog: Pick<AuditLogApi, "record" | "hasRecordedSince">;
  now: () => Instant;
}>;

/**
 * Writes the end of every impersonation window exactly once, whether it was stopped, ran out,
 * or was replaced by a new window, then clears the claims. A customer organization gets the end
 * row only when it got this window's start. Spec: specs/identity/admin-impersonation.feature.
 */
export class ImpersonationEndService {
  private constructor(private readonly deps: ImpersonationEndDeps) {}

  static create({
    now = nowInstant,
    ...deps
  }: Omit<ImpersonationEndDeps, "now"> & { now?: () => Instant }): ImpersonationEndService {
    return new ImpersonationEndService({ ...deps, now });
  }

  /** Settles every lapsed window found; answers how many were cleared. */
  async sweep(): Promise<number> {
    const lapsed = await this.deps.sessions.findLapsedImpersonations({
      before: this.deps.now(),
      limit: SWEEP_BATCH,
    });
    let expired = 0;
    for (const window of lapsed) {
      await this.audit({ window, action: IMPERSONATION_EXPIRED_ACTION });
      if (await this.deps.sessions.clearLapsedImpersonation(window)) expired += 1;
    }
    return expired;
  }

  /** Ends the session's window, as stopped while live or expired once lapsed. */
  async stop({ sessionId }: { sessionId: string }): Promise<void> {
    await this.settle({ sessionId });
    await this.deps.sessions.clearImpersonation({ sessionId });
  }

  /** Opens a window; a lapsed one the session still carries is recorded as expired first. */
  async start({
    sessionId,
    ...claims
  }: SessionImpersonation & { sessionId: string }): Promise<void> {
    await this.settle({ sessionId });
    await this.deps.sessions.writeImpersonation({ sessionId, claims });
  }

  private async settle({ sessionId }: { sessionId: string }): Promise<void> {
    const claims = (await this.deps.sessions.findById({ id: sessionId }))?.impersonation;
    if (!claims?.expiresAt) return;
    const window = { sessionId, ...claims, expiresAt: claims.expiresAt };
    const lapsed = Temporal.Instant.compare(window.expiresAt, this.deps.now()) <= 0;
    await this.audit({
      window,
      action: lapsed ? IMPERSONATION_EXPIRED_ACTION : IMPERSONATION_STOPPED_ACTION,
    });
    await this.deps.sessions.clearLapsedImpersonation(window);
  }

  /** A retry after a failed clear finds each organization's row written and writes it once. */
  private async audit({
    window,
    action,
  }: {
    window: LapsedImpersonation;
    action: string;
  }): Promise<void> {
    const { actorUserId, subjectUserId } = window;
    if (!actorUserId || !subjectUserId) return;
    const target = { userId: actorUserId, targetKind: "session", targetId: window.sessionId };
    const startedAtMs = window.expiresAt.epochMilliseconds - IMPERSONATION_WINDOW_MS;
    const organizationIds = await this.organizationsThatSawTheStart({
      target,
      subjectUserId,
      sinceMs: startedAtMs - START_ROW_SKEW_MS,
    });
    const args = {
      userIdImpersonated: subjectUserId,
      reason: window.reason,
      ...(action === IMPERSONATION_EXPIRED_ACTION
        ? { expiredAt: window.expiresAt.toString() }
        : { stoppedAt: this.deps.now().toString() }),
    };
    // A window whose start no customer saw (one opened before start rows named the session)
    // ends in the operators' own log only, never in a customer's.
    for (const organizationId of organizationIds.length > 0 ? organizationIds : [undefined]) {
      const scope = organizationId ? { organizationId } : {};
      const alreadyAudited = await this.deps.auditLog.hasRecordedSince({
        ...target,
        action,
        ...scope,
        // An earlier window's end on this session is written before this one could end.
        sinceMs:
          action === IMPERSONATION_EXPIRED_ACTION
            ? window.expiresAt.epochMilliseconds
            : startedAtMs,
      });
      if (alreadyAudited) continue;
      await this.deps.auditLog.record({ ...target, action, actorUserId, ...scope, args });
    }
  }

  private async organizationsThatSawTheStart({
    target,
    subjectUserId,
    sinceMs,
  }: {
    target: { userId: string; targetKind: string; targetId: string };
    subjectUserId: string;
    sinceMs: number;
  }): Promise<string[]> {
    const memberOf = await this.deps.memberships.organizationIdsForMember({
      userId: subjectUserId,
    });
    const saw: string[] = [];
    for (const organizationId of memberOf) {
      const started = await this.deps.auditLog.hasRecordedSince({
        ...target,
        action: IMPERSONATION_STARTED_ACTION,
        organizationId,
        sinceMs,
      });
      if (started) saw.push(organizationId);
    }
    return saw;
  }
}
