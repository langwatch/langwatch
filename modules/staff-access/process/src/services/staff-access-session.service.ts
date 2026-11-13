import type { ApiKeyApi } from "@langwatch/api-key-contract";
import type { AuditLogApi } from "@langwatch/audit-log-contract";
import type { StaffAccessScope } from "@langwatch/authz-contract";
import { createLogger } from "@langwatch/observability";
import {
  STAFF_ACCESS_PRINCIPAL,
  STAFF_ACCESS_REVOKE_ALL_CONFIRMATION,
  StaffAccessAlreadyEndedError,
  StaffAccessConfirmationMismatchError,
  StaffAccessNotFoundError,
  type StaffAccessRequestStatus,
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
import type { StaffAccessNoticeService } from "./staff-access-notice.service.ts";
import type { StaffAccessRequesterService } from "./staff-access-requester.service.ts";

const logger = createLogger("langwatch:staff-access:session");

const RECENT_SESSIONS_LIMIT = 100;
const SWEEP_BATCH = 100;

type SessionDeps = Readonly<{
  requests: StaffAccessRequestRepository;
  requesters: StaffAccessRequesterService;
  apiKeys: Pick<ApiKeyApi, "revokeStaffAccessKey">;
  auditLog: Pick<AuditLogApi, "record" | "hasRecordedSince">;
  users: Pick<UserApi, "findById">;
  notices: StaffAccessNoticeService;
  now: () => Instant;
}>;

/**
 * Staff access sessions once they exist (ADR-202): how they are shown, ended by the agent or an
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
  }): Promise<{ revoked: number; failed: number }> {
    if (confirmation.trim().toLowerCase() !== STAFF_ACCESS_REVOKE_ALL_CONFIRMATION) {
      throw new StaffAccessConfirmationMismatchError();
    }
    const live = await this.deps.requests.findLive({ at: this.deps.now() });
    return this.endEach({ rows: live, byUserId: userId, cause: "revoked_all" });
  }

  /**
   * Revokes one of the operator's enrolled agents and ends every live session and undecided
   * request it made, so its keys stop at once; the other operators are told.
   * @throws {StaffAccessNotFoundError} for another operator's agent or one already revoked
   */
  async revokeRequester({
    userId,
    requesterId,
  }: {
    userId: string;
    requesterId: string;
  }): Promise<{ revoked: number; failed: number }> {
    const requester = await this.deps.requesters.revoke({ userId, requesterId });
    const live = await this.deps.requests.findLive({ at: this.deps.now() });
    const ended = await this.endEach({
      rows: live.filter((row) => row.requesterId === requesterId),
      byUserId: userId,
      cause: "requester_revoked",
    });
    await this.deps.notices.tellOtherOperators({
      actingUserId: userId,
      subject: "An operator revoked an enrolled agent",
      lines: [
        { label: "Agent", value: requester.name },
        { label: "Sessions and requests ended", value: String(ended.revoked) },
      ],
      idempotencyKey: `staff-access-requester-revoked:${requesterId}`,
    });
    return ended;
  }

  /** Ends each row on its own, so one failure leaves the others ended and is counted. */
  private async endEach({
    rows,
    byUserId,
    cause,
  }: {
    rows: readonly StaffAccessRequestRow[];
    byUserId: string;
    cause: string;
  }): Promise<{ revoked: number; failed: number }> {
    const settled = await Promise.allSettled(
      rows.map((row) => this.endSession({ row, byUserId, cause })),
    );
    let revoked = 0;
    let failed = 0;
    for (const [index, outcome] of settled.entries()) {
      if (outcome.status === "fulfilled") {
        if (outcome.value) revoked += 1;
        continue;
      }
      failed += 1;
      logger.error(
        { error: outcome.reason, requestId: rows[index]?.id, cause },
        "a staff access session did not end cleanly; the sweep retries its end",
      );
    }
    return { revoked, failed };
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

  /**
   * Tells the customer of every end not yet audited: a natural expiry, or a revoke whose key
   * revoke or audit write failed. A row is marked only after its write, so a failure retries
   * on the next tick and a crash can at worst write one row twice.
   */
  async sweepExpiredSessions({ at }: { at: Instant }): Promise<{ audited: number }> {
    const ended = await this.deps.requests.findEndedUnaudited({ at, limit: SWEEP_BATCH });
    let audited = 0;
    for (const row of ended) {
      try {
        await this.auditEnd({ row, at });
        audited += 1;
      } catch (error) {
        logger.error({ error, requestId: row.id }, "a staff access end was not audited; retrying");
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

  /**
   * Ends a live session or request once, revokes its key and audits the end; false when it was
   * not live. A failure after the revoke leaves the end for the sweep to finish.
   */
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
    const ended = current ?? {
      ...row,
      revokedAt: at,
      revokedByUserId: byUserId,
      revokeCause: cause,
    };
    // An approval still being written is finished by the sweep, once its audit row settled.
    if (ended.signedHash !== null && ended.approvedAt === null) return true;
    await this.auditEnd({ row: ended, at });
    return true;
  }

  /** Revokes the key of a revoked row and writes its end row if the customer saw it approved. */
  private async auditEnd({ row, at }: { row: StaffAccessRequestRow; at: Instant }): Promise<void> {
    if (row.revokedAt !== null && row.apiKeyId) {
      await this.deps.apiKeys.revokeStaffAccessKey({ apiKeyId: row.apiKeyId });
    }
    if (await this.customerSawApproval({ row })) {
      await this.recordEnd({
        row,
        action: row.revokedAt !== null ? "staffAccess.revoked" : "staffAccess.expired",
        byUserId: row.revokedAt !== null ? row.revokedByUserId : null,
        cause: row.revokedAt !== null ? (row.revokeCause ?? "revoked") : "expired",
      });
    }
    if (row.signedHash !== null) await this.deps.requests.markEndAudited({ id: row.id, at });
  }

  /** A confirmed approval was audited; one never confirmed is asked of the audit log. */
  private async customerSawApproval({ row }: { row: StaffAccessRequestRow }): Promise<boolean> {
    if (!row.organizationId || row.signedHash === null) return false;
    if (row.approvedAt !== null) return true;
    return this.deps.auditLog.hasRecordedSince({
      userId: row.ownerUserId,
      action: "staffAccess.approved",
      targetKind: "staffAccess",
      targetId: row.id,
      sinceMs: row.createdAt.epochMilliseconds,
      organizationId: row.organizationId,
    });
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
    const [approvedBy, revokedBy] = await Promise.all([
      this.personOf({ id: row.ownerUserId }),
      byUserId ? this.personOf({ id: byUserId }) : null,
    ]);
    await this.deps.auditLog.record({
      organizationId: row.organizationId,
      userId: row.ownerUserId,
      ...(byUserId ? { actorUserId: byUserId } : {}),
      action,
      targetKind: "staffAccess",
      targetId: row.id,
      metadata: {
        principal: STAFF_ACCESS_PRINCIPAL,
        approvedBy,
        ...(revokedBy ? { revokedBy } : {}),
        reason: row.reason,
        scopes: row.scopes,
        cause,
      },
    });
  }

  private async personOf({
    id,
  }: {
    id: string;
  }): Promise<{ id: string; name: string | null; email: string | null }> {
    const user = await this.deps.users.findById({ id });
    return { id, name: user?.name ?? null, email: user?.email ?? null };
  }

  private async rowOf({ id }: { id: string }): Promise<StaffAccessRequestRow> {
    const [row] = await this.deps.requests.findById({ id });
    if (!row) throw new StaffAccessNotFoundError();
    return row;
  }

  /** The status a reader sees; an approval still being written reads as pending. */
  statusOf({ row, at }: { row: StaffAccessRequestRow; at: Instant }): StaffAccessRequestStatus {
    const status = row.status === "approving" ? "pending" : row.status;
    return shownStatus({ ...row, status, at });
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
      status: this.statusOf({ row, at }),
      scopes: row.scopes as StaffAccessScope[],
      organizationId: row.organizationId,
      organizationName: row.organizationName,
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
