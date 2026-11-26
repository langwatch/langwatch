import { StaffAccessAuditUnavailableError } from "@langwatch/api";
import type { AuditLogApi } from "@langwatch/audit-log-contract";
import { createLogger } from "@langwatch/observability";
import { STAFF_ACCESS_PRINCIPAL } from "@langwatch/staff-access-contract";
import type { Instant } from "@langwatch/time";
import type { UserApi } from "@langwatch/user-contract";

import type {
  StaffAccessRequestRepository,
  StaffAccessRequestRow,
} from "../repositories/staff-access.repository.ts";

const logger = createLogger("langwatch:staff-access:request");

type ApprovalAuditDeps = Readonly<{
  requests: Pick<StaffAccessRequestRepository, "revoke">;
  auditLog: Pick<AuditLogApi, "record">;
  users: Pick<UserApi, "findById">;
  now: () => Instant;
}>;

/** The approval's row in the customer's audit log, and the revoke when that row did not stand. */
export class StaffAccessApprovalAuditService {
  private constructor(private readonly deps: ApprovalAuditDeps) {}

  static create(deps: ApprovalAuditDeps): StaffAccessApprovalAuditService {
    return new StaffAccessApprovalAuditService(deps);
  }

  /**
   * Writes the approval row to the customer's audit log. Any failure, the approver lookup
   * included, abandons the approval and refuses the operator.
   * @throws {StaffAccessAuditUnavailableError} when the row was not written
   */
  async recordApproval({
    row,
    userId,
    spendApproved,
  }: {
    row: StaffAccessRequestRow;
    userId: string;
    spendApproved: boolean;
  }): Promise<void> {
    if (!row.organizationId) return;
    try {
      const approver = await this.deps.users.findById({ id: userId });
      await this.deps.auditLog.record({
        organizationId: row.organizationId,
        userId,
        actorUserId: userId,
        action: "staffAccess.approved",
        targetKind: "staffAccess",
        targetId: row.id,
        ...(row.requestIp ? { ipAddress: row.requestIp } : {}),
        metadata: {
          principal: STAFF_ACCESS_PRINCIPAL,
          approvedBy: { id: userId, name: approver?.name ?? null, email: approver?.email ?? null },
          reason: row.reason,
          scopes: row.scopes,
          spendApproved,
          machine: row.machine,
        },
      });
    } catch (error) {
      logger.error({ error, requestId: row.id }, "the staff access approval row was not written");
      await this.abandonApproval({ id: row.id, userId });
      throw new StaffAccessAuditUnavailableError();
    }
  }

  /**
   * Ends an approval that did not stand. Should this revoke fail too, the request stays
   * approving, which no redeem accepts, and the sweep settles its end once it lapses.
   */
  async abandonApproval({ id, userId }: { id: string; userId: string }): Promise<void> {
    try {
      await this.deps.requests.revoke({
        id,
        at: this.deps.now(),
        byUserId: userId,
        cause: "approval_audit_failed",
      });
    } catch (error) {
      logger.error({ error, requestId: id }, "an abandoned staff access approval was not revoked");
    }
  }
}
