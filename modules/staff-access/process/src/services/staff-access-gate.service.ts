import {
  StaffAccessAuditUnavailableError,
  StaffAccessExpiredError,
  StaffAccessIpMismatchError,
  StaffAccessOperatorLostError,
  StaffAccessRevokedError,
  StaffAccessUnavailableError,
  StaffSpendNotApprovedError,
} from "@langwatch/api";
import type {
  RestStaffAccessGate,
  RestStaffAccessReceipt,
  RestStaffAccessRequest,
} from "@langwatch/api/rest";
import type { AuditLogApi } from "@langwatch/audit-log-contract";
import { generate } from "@langwatch/ksuid";
import { createLogger } from "@langwatch/observability";
import type { OpsApi } from "@langwatch/ops-contract";
import { STAFF_ACCESS_PRINCIPAL } from "@langwatch/staff-access-contract";
import type { Instant } from "@langwatch/time";

import type {
  StaffAccessEventRepository,
  StaffAccessRequestRow,
} from "../repositories/staff-access.repository.ts";
import { hasPassed } from "../rules/staff-access.rules.ts";
import type { StaffAccessAvailabilityService } from "./staff-access-availability.service.ts";
import type { StaffAccessSessionService } from "./staff-access-session.service.ts";

const logger = createLogger("langwatch:staff-access:gate");

const READ_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * Whether a request changes the organization: a read sent as a POST (trace search, analytics)
 * asks only `:view` permissions and is no write. A route that asks none falls back to its method.
 */
function writes(request: RestStaffAccessRequest): boolean {
  if (READ_METHODS.has(request.method.toUpperCase())) return false;
  const asked = request.permissions;
  return asked.length === 0 || !asked.every((permission) => permission.endsWith(":view"));
}

type GateDeps = Readonly<{
  availability: StaffAccessAvailabilityService;
  sessions: Pick<StaffAccessSessionService, "findByApiKeyId">;
  events: StaffAccessEventRepository;
  ops: Pick<OpsApi, "listPlatformOperators">;
  auditLog: Pick<AuditLogApi, "record">;
  now: () => Instant;
}>;

/**
 * The gate every staff key's request passes before its handler (ADR-202): a live session, from
 * its pinned address, approved by a current operator, spending only when approved to. The trail
 * row comes first, a write also lands in the customer's audit log, and a failed write refuses.
 */
export class StaffAccessGateService implements RestStaffAccessGate {
  private constructor(private readonly deps: GateDeps) {}

  static create(deps: GateDeps): StaffAccessGateService {
    return new StaffAccessGateService(deps);
  }

  async admit(request: RestStaffAccessRequest): Promise<RestStaffAccessReceipt> {
    if (!(await this.deps.availability.isOpen())) throw new StaffAccessUnavailableError();
    const [session] = await this.deps.sessions.findByApiKeyId({ apiKeyId: request.apiKeyId });
    const at = this.deps.now();
    await this.assertLive({ session, request, at });
    const live = session as StaffAccessRequestRow;

    const eventId = generate("staffevent").toString();
    try {
      await this.deps.events.create({
        id: eventId,
        requestId: live.id,
        at,
        method: request.method,
        path: request.path,
        operation: request.operation,
        permissions: [...request.permissions],
        organizationId: live.organizationId,
        projectId: request.scope?.tier === "project" ? request.scope.id : null,
        status: null,
        errorCode: null,
        durationMs: null,
        ipAddress: request.ipAddress,
        userAgent: request.userAgent,
      });
      if (writes(request) && live.organizationId) {
        await this.deps.auditLog.record({
          organizationId: live.organizationId,
          ...(request.scope?.tier === "project" ? { projectId: request.scope.id } : {}),
          userId: live.ownerUserId,
          actorUserId: live.ownerUserId,
          action: "staffAccess.write",
          targetKind: "staffAccess",
          targetId: live.id,
          ...(request.ipAddress ? { ipAddress: request.ipAddress } : {}),
          ...(request.userAgent ? { userAgent: request.userAgent } : {}),
          metadata: {
            principal: STAFF_ACCESS_PRINCIPAL,
            approvedBy: { id: live.ownerUserId },
            reason: live.reason,
            method: request.method,
            path: request.path,
            operation: request.operation,
          },
        });
      }
    } catch (error) {
      logger.error({ error, requestId: live.id }, "the staff access trail could not be written");
      throw new StaffAccessAuditUnavailableError();
    }

    return {
      staff: {
        principal: STAFF_ACCESS_PRINCIPAL,
        approverUserId: live.ownerUserId,
        reason: live.reason,
      },
      finish: (outcome) => this.deps.events.finish({ id: eventId, ...outcome }),
    };
  }

  private async assertLive({
    session,
    request,
    at,
  }: {
    session: StaffAccessRequestRow | undefined;
    request: RestStaffAccessRequest;
    at: Instant;
  }): Promise<void> {
    if (!session || session.revokedAt !== null || session.status !== "redeemed") {
      throw new StaffAccessRevokedError();
    }
    if (session.accessExpiresAt === null || hasPassed({ moment: session.accessExpiresAt, at })) {
      throw new StaffAccessExpiredError();
    }
    if (session.pinnedIp !== request.ipAddress) throw new StaffAccessIpMismatchError();
    const operators = await this.deps.ops.listPlatformOperators();
    if (!operators.some((operator) => operator.userId === session.ownerUserId)) {
      throw new StaffAccessOperatorLostError();
    }
    if (request.spends && !session.spendApproved) throw new StaffSpendNotApprovedError();
  }
}
