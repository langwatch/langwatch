import {
  StaffAccessAuditUnavailableError,
  StaffAccessExpiredError,
  StaffAccessIpMismatchError,
  StaffAccessOperatorLostError,
  StaffAccessRevokedError,
  StaffAccessUnavailableError,
  StaffContentNotApprovedError,
  StaffSpendNotApprovedError,
  StaffWriteNotAllowedError,
} from "@langwatch/api";
import type {
  RestStaffAccessGate,
  RestStaffAccessReceipt,
  RestStaffAccessRefusal,
  RestStaffAccessRequest,
} from "@langwatch/api/rest";
import type { AuditLogApi } from "@langwatch/audit-log-contract";
import { STAFF_WRITES_WITHOUT_SPEND } from "@langwatch/authz-contract";
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

const WRITES_WITHOUT_SPEND: ReadonlySet<string> = new Set(STAFF_WRITES_WITHOUT_SPEND);

type Refusal =
  | StaffAccessRevokedError
  | StaffAccessExpiredError
  | StaffAccessIpMismatchError
  | StaffAccessOperatorLostError
  | StaffSpendNotApprovedError
  | StaffContentNotApprovedError
  | StaffWriteNotAllowedError;

/**
 * What a live session may do on a route, failing closed (ADR-202). A read passes unless it serves
 * content to a key without `org:content`. A write never removes or disables a record; without the
 * spend tick it passes only when every permission it asks is a dataset write.
 */
function routeRefusal({
  session,
  request,
}: {
  session: StaffAccessRequestRow;
  request: RestStaffAccessRequest;
}): Refusal | null {
  if (request.spends && !session.spendApproved) return new StaffSpendNotApprovedError();
  if (request.servesContent && !session.scopes.includes("org:content")) {
    return new StaffContentNotApprovedError();
  }
  if (!request.writes) return null;
  if (request.confirms) return new StaffWriteNotAllowedError();
  if (session.spendApproved) return null;
  const asked = request.permissions;
  if (asked.length > 0 && asked.every((permission) => WRITES_WITHOUT_SPEND.has(permission))) {
    return null;
  }
  return new StaffSpendNotApprovedError();
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
    if (!session) throw new StaffAccessRevokedError();
    const refusal =
      (await this.liveRefusal({ session, request, at })) ?? routeRefusal({ session, request });
    if (refusal) {
      await this.trailRefusal({
        session,
        at,
        refusal: { ...request, status: refusal.httpStatus, errorCode: refusal.code },
      });
      throw refusal;
    }
    const live = session;

    const eventId = generate("staffevent").toString();
    try {
      await this.deps.events.create({
        ...this.trailRow({ session: live, request, at }),
        id: eventId,
        status: null,
        errorCode: null,
        durationMs: null,
      });
      if (request.writes && live.organizationId) {
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
      spendApproved: live.spendApproved,
      finish: (outcome) => this.deps.events.finish({ id: eventId, ...outcome }),
    };
  }

  /** A staff key's request refused before `admit` (its permission, another project) is trailed. */
  async refused(refusal: RestStaffAccessRefusal): Promise<void> {
    const [session] = await this.deps.sessions.findByApiKeyId({ apiKeyId: refusal.apiKeyId });
    if (!session) return;
    await this.trailRefusal({ session, at: this.deps.now(), refusal });
  }

  /** The trail row of a refused request, written with its answer. A failed write is logged. */
  private async trailRefusal({
    session,
    at,
    refusal,
  }: {
    session: StaffAccessRequestRow;
    at: Instant;
    refusal: RestStaffAccessRefusal;
  }): Promise<void> {
    try {
      await this.deps.events.create({
        ...this.trailRow({ session, request: refusal, at }),
        id: generate("staffevent").toString(),
        status: refusal.status,
        errorCode: refusal.errorCode,
        durationMs: 0,
      });
    } catch (error) {
      logger.error({ error, requestId: session.id }, "a refused staff request was not trailed");
    }
  }

  private trailRow({
    session,
    request,
    at,
  }: {
    session: StaffAccessRequestRow;
    request: RestStaffAccessRequest;
    at: Instant;
  }) {
    return {
      requestId: session.id,
      at,
      method: request.method,
      path: request.path,
      operation: request.operation,
      permissions: [...request.permissions],
      organizationId: session.organizationId,
      projectId: request.scope?.tier === "project" ? request.scope.id : null,
      ipAddress: request.ipAddress,
      userAgent: request.userAgent,
    };
  }

  /** Why the session itself no longer admits anything, or null while it is live. */
  private async liveRefusal({
    session,
    request,
    at,
  }: {
    session: StaffAccessRequestRow;
    request: RestStaffAccessRequest;
    at: Instant;
  }): Promise<Refusal | null> {
    if (session.revokedAt !== null || session.status !== "redeemed") {
      return new StaffAccessRevokedError();
    }
    if (session.accessExpiresAt === null || hasPassed({ moment: session.accessExpiresAt, at })) {
      return new StaffAccessExpiredError();
    }
    if (session.pinnedIp !== request.ipAddress) return new StaffAccessIpMismatchError();
    const operators = await this.deps.ops.listPlatformOperators();
    if (!operators.some((operator) => operator.userId === session.ownerUserId)) {
      return new StaffAccessOperatorLostError();
    }
    return null;
  }
}
