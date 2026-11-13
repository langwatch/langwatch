import type { ApiKeyApi } from "@langwatch/api-key-contract";
import type { AuditLogApi } from "@langwatch/audit-log-contract";
import type { StaffAccessScope } from "@langwatch/authz-contract";
import {
  STAFF_ACCESS_PRINCIPAL,
  STAFF_ACCESS_REVOKE_ALL_CONFIRMATION,
  StaffAccessAlreadyEndedError,
  StaffAccessConfirmationMismatchError,
  StaffAccessNotFoundError,
  type StaffAccessSessionView,
} from "@langwatch/staff-access-contract";
import type { Instant } from "@langwatch/time";
import type { UserApi } from "@langwatch/user-contract";

import type {
  StaffAccessRequestRepository,
  StaffAccessRequestRow,
} from "../repositories/staff-access.repository.ts";
import {
  isoText,
  later,
  shownStatus,
  STAFF_ACCESS_RECENT_WINDOW_MS,
} from "../rules/staff-access.rules.ts";
import type { StaffAccessRequesterService } from "./staff-access-requester.service.ts";

const RECENT_SESSIONS_LIMIT = 100;
const SWEEP_BATCH = 100;

type SessionDeps = Readonly<{
  requests: StaffAccessRequestRepository;
  requesters: StaffAccessRequesterService;
  apiKeys: Pick<ApiKeyApi, "revokeStaffAccessKey">;
  auditLog: Pick<AuditLogApi, "record">;
  users: Pick<UserApi, "findById">;
  now: () => Instant;
}>;

/**
 * Staff access sessions once they exist (ADR-193): how they are shown, ended by the agent or an
 * operator, killed all at once, and audited when their hour runs out.
 */
export class StaffAccessSessionService {
  private constructor(private readonly deps: SessionDeps) {}

  static create(deps: SessionDeps): StaffAccessSessionService {
    return new StaffAccessSessionService(deps);
  }

  /** The agent ends its own session early; ending one already over answers the same. */
  async endByAgent({
    requestId,
    requesterId,
    opsRequestId,
  }: {
    requestId: string;
    requesterId?: string;
    opsRequestId?: string;
  }): Promise<{ ended: true }> {
    const [row] = await this.deps.requests.findById({ id: requestId });
    const owns =
      row !== undefined &&
      (row.requesterId === requesterId || (opsRequestId !== undefined && row.id === opsRequestId));
    if (!owns) throw new StaffAccessNotFoundError();
    await this.endSession({ row, byUserId: null, cause: "ended_by_agent" });
    return { ended: true };
  }

  /**
   * Any operator may end any session or undecided request.
   * @throws {StaffAccessAlreadyEndedError} when it already ended
   */
  async revokeSession({ userId, requestId }: { userId: string; requestId: string }): Promise<void> {
    const row = await this.rowOf({ id: requestId });
    if (!(await this.endSession({ row, byUserId: userId, cause: "revoked_by_operator" }))) {
      throw new StaffAccessAlreadyEndedError();
    }
  }

  /** @throws {StaffAccessConfirmationMismatchError} unless the operator typed "revoke all" */
  async revokeAll({
    userId,
    confirmation,
  }: {
    userId: string;
    confirmation: string;
  }): Promise<{ revoked: number }> {
    if (confirmation.trim().toLowerCase() !== STAFF_ACCESS_REVOKE_ALL_CONFIRMATION) {
      throw new StaffAccessConfirmationMismatchError();
    }
    const live = await this.deps.requests.findLive({ at: this.deps.now() });
    const ended = await Promise.all(
      live.map((row) => this.endSession({ row, byUserId: userId, cause: "revoked_all" })),
    );
    return { revoked: ended.filter(Boolean).length };
  }

  /** Live and recent sessions across every operator, newest first. */
  async findRecentSessions(): Promise<StaffAccessSessionView[]> {
    const at = this.deps.now();
    const rows = await this.deps.requests.findRecent({
      since: later({ at, ms: -STAFF_ACCESS_RECENT_WINDOW_MS }),
      limit: RECENT_SESSIONS_LIMIT,
    });
    return this.viewsOf({ rows });
  }

  /** Audits each session whose hour passed unrevoked, once; a failed write retries next tick. */
  async sweepExpiredSessions({ at }: { at: Instant }): Promise<{ audited: number }> {
    const ended = await this.deps.requests.findEndedUnaudited({ at, limit: SWEEP_BATCH });
    let audited = 0;
    for (const row of ended) {
      if (!(await this.deps.requests.claimEndAudit({ id: row.id, at }))) continue;
      try {
        await this.recordEnd({
          row,
          action: "staffAccess.expired",
          byUserId: null,
          cause: "expired",
        });
        audited += 1;
      } catch (error) {
        await this.deps.requests.releaseEndAudit({ id: row.id });
        throw error;
      }
    }
    return { audited };
  }

  /** The session an ops token's lookup id names, for the door. */
  async findByOpsTokenLookupId({
    lookupId,
  }: {
    lookupId: string;
  }): Promise<StaffAccessRequestRow[]> {
    return this.deps.requests.findByOpsTokenLookupId({ lookupId });
  }

  async findByApiKeyId({ apiKeyId }: { apiKeyId: string }): Promise<StaffAccessRequestRow[]> {
    return this.deps.requests.findByApiKeyId({ apiKeyId });
  }

  /** Ends a live session once, revokes its key and audits the end; false when it was not live. */
  async endSession({
    row,
    byUserId,
    cause,
  }: {
    row: StaffAccessRequestRow;
    byUserId: string | null;
    cause: string;
  }): Promise<boolean> {
    const at = this.deps.now();
    if (!(await this.deps.requests.revoke({ id: row.id, at, byUserId, cause }))) return false;
    const [current] = await this.deps.requests.findById({ id: row.id });
    const apiKeyId = current?.apiKeyId ?? row.apiKeyId;
    if (apiKeyId) await this.deps.apiKeys.revokeStaffAccessKey({ apiKeyId });
    // An undecided request never reached the customer, so only an approved one is audited there.
    if ((current?.approvedAt ?? row.approvedAt) !== null) {
      await this.recordEnd({ row, action: "staffAccess.revoked", byUserId, cause });
    }
    return true;
  }

  private async recordEnd({
    row,
    action,
    byUserId,
    cause,
  }: {
    row: StaffAccessRequestRow;
    action: "staffAccess.revoked" | "staffAccess.expired";
    byUserId: string | null;
    cause: string;
  }): Promise<void> {
    if (!row.organizationId) return;
    await this.deps.auditLog.record({
      organizationId: row.organizationId,
      userId: row.ownerUserId,
      ...(byUserId ? { actorUserId: byUserId } : {}),
      action,
      targetKind: "staffAccess",
      targetId: row.id,
      metadata: {
        principal: STAFF_ACCESS_PRINCIPAL,
        approvedBy: { id: row.ownerUserId },
        reason: row.reason,
        scopes: row.scopes,
        cause,
      },
    });
  }

  private async rowOf({ id }: { id: string }): Promise<StaffAccessRequestRow> {
    const [row] = await this.deps.requests.findById({ id });
    if (!row) throw new StaffAccessNotFoundError();
    return row;
  }

  async viewsOf({
    rows,
  }: {
    rows: readonly StaffAccessRequestRow[];
  }): Promise<StaffAccessSessionView[]> {
    const at = this.deps.now();
    const requesters = await this.deps.requesters.findByIds({
      ids: rows.map((row) => row.requesterId),
    });
    const ownerIds = [...new Set(rows.map((row) => row.ownerUserId))];
    const owners = await Promise.all(ownerIds.map((id) => this.deps.users.findById({ id })));
    const emailOf = new Map(ownerIds.map((id, index) => [id, owners[index]?.email ?? null]));
    const nameOf = new Map(requesters.map((requester) => [requester.id, requester.name]));

    return rows.map((row) => ({
      requestId: row.id,
      status: shownStatus({ ...row, at }),
      scopes: row.scopes as StaffAccessScope[],
      organizationId: row.organizationId,
      organizationName: row.organizationName,
      counterpartOrganizationId: row.counterpartOrganizationId,
      counterpartOrganizationName: row.counterpartOrganizationName,
      reason: row.reason,
      machine: row.machine,
      requestIp: row.requestIp,
      requesterName: nameOf.get(row.requesterId) ?? "",
      ownerUserId: row.ownerUserId,
      ownerEmail: emailOf.get(row.ownerUserId) ?? null,
      spendApproved: row.spendApproved,
      createdAt: isoText(row.createdAt),
      expiresAt: isoText(row.expiresAt),
      approvedAt: row.approvedAt ? isoText(row.approvedAt) : null,
      redeemedAt: row.redeemedAt ? isoText(row.redeemedAt) : null,
      accessExpiresAt: row.accessExpiresAt ? isoText(row.accessExpiresAt) : null,
      revokedAt: row.revokedAt ? isoText(row.revokedAt) : null,
    }));
  }
}
