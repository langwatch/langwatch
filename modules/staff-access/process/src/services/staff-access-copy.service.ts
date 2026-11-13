import {
  StaffAccessAuditUnavailableError,
  StaffAccessIpMismatchError,
  StaffAccessOperatorLostError,
} from "@langwatch/api";
import type { AuditLogApi } from "@langwatch/audit-log-contract";
import { staffCopyGrant } from "@langwatch/authz-contract";
import type { DatasetApi } from "@langwatch/dataset-contract";
import type { EvaluatorApi } from "@langwatch/evaluator-contract";
import { HandledError } from "@langwatch/handled-error";
import { generate } from "@langwatch/ksuid";
import type { MonitorApi } from "@langwatch/monitor-contract";
import type { OpsApi } from "@langwatch/ops-contract";
import type {
  OrganizationApi,
  OrganizationProvisioningSummary,
} from "@langwatch/organization-contract";
import type { ProjectApi } from "@langwatch/project-contract";
import type { PromptApi } from "@langwatch/prompt-contract";
import {
  STAFF_ACCESS_OPS_TOKEN_PREFIX,
  STAFF_ACCESS_PRINCIPAL,
  StaffAccessNotFoundError,
  StaffCopyApprovalsMismatchError,
  StaffCopyDirectionMismatchError,
  StaffCopySameOrganizationError,
  StaffCopyScopeMissingError,
  StaffCopySourceInvalidError,
  StaffCopyWindowClosedError,
  type StaffAccessCopyBody,
  type StaffAccessCopyItem,
  type StaffAccessCopyReport,
  type StaffAccessDoorSession,
} from "@langwatch/staff-access-contract";
import type { Instant } from "@langwatch/time";

import type {
  StaffAccessCopyLedgerRepository,
  StaffAccessEventRepository,
  StaffAccessRequestRepository,
  StaffAccessRequestRow,
} from "../repositories/staff-access.repository.ts";
import {
  auditedPlan,
  COPY_SOURCE_SCOPES,
  COPY_TARGET_SCOPES,
  copyTotals,
  holdsScopes,
} from "../rules/staff-access-copy.rules.ts";
import { hasPassed, parseToken, secretMatches } from "../rules/staff-access.rules.ts";
import { StaffAccessCopyRunService } from "./staff-access-copy-run.service.ts";

const COPY_OPERATION = "staffAccess.copyOrganization";
const COPY_PATH = "/api/staff-access/ops/copies";

/** The audit action for each moment of a copy, written in both organizations. */
const AUDIT_ACTION = {
  planned: "staffAccess.orgCopyPlanned",
  copy: "staffAccess.orgCopy",
  stopped: "staffAccess.orgCopyStopped",
} as const;

type CopyDeps = Readonly<{
  requests: Pick<StaffAccessRequestRepository, "findById" | "findByOpsTokenLookupId">;
  events: StaffAccessEventRepository;
  ledger: StaffAccessCopyLedgerRepository;
  ops: Pick<OpsApi, "listPlatformOperators">;
  organizations: Pick<OrganizationApi, "findProvisioningSummary" | "listTeams">;
  projects: Pick<ProjectApi, "listByOrganization" | "findById" | "createInOrganization">;
  evaluators: Pick<EvaluatorApi, "getAll" | "create">;
  monitors: Pick<MonitorApi, "list" | "create" | "toggle">;
  prompts: Pick<PromptApi, "getAllPrompts" | "getAllVersions" | "createPrompt" | "updatePrompt">;
  datasets: Pick<DatasetApi, "findDatasetSummaries" | "copyDataset">;
  auditLog: Pick<AuditLogApi, "record">;
  now: () => Instant;
}>;

type OpsSession = Extract<StaffAccessDoorSession, { kind: "ops" }>;
type Side = Readonly<{ row: StaffAccessRequestRow; organization: OrganizationProvisioningSummary }>;

/**
 * Copies one organization's allowlisted setup into another (module ADR-002): two live approvals
 * from one agent and operator, both trails and audit logs written before anything is copied.
 */
export class StaffAccessCopyService {
  readonly #run: StaffAccessCopyRunService;

  private constructor(private readonly deps: CopyDeps) {
    this.#run = StaffAccessCopyRunService.create(deps);
  }

  static create(deps: CopyDeps): StaffAccessCopyService {
    return new StaffAccessCopyService(deps);
  }

  async copyOrganization({
    session,
    body,
  }: {
    session: StaffAccessDoorSession;
    body: StaffAccessCopyBody;
  }): Promise<StaffAccessCopyReport> {
    const bearer = opsSessionOf(session);
    const { source, target } = await this.pairedSides({ bearer, body });
    const dryRun = body.dryRun === true;

    const startedAt = this.deps.now();
    const eventIds = await this.writeTrail({ bearer, source, target, at: startedAt });
    const finish = (status: number, errorCode: string | null) =>
      Promise.all(
        eventIds.map((id) =>
          this.deps.events
            .finish({
              id,
              status,
              errorCode,
              durationMs: this.deps.now().epochMilliseconds - startedAt.epochMilliseconds,
            })
            .catch(() => undefined),
        ),
      );
    try {
      const planned = await this.#run.plan({
        source: source.organization,
        target: target.organization,
        projects: body.projects,
      });
      await this.writeAudit({
        bearer,
        source,
        target,
        items: planned.items,
        action: dryRun ? AUDIT_ACTION.planned : AUDIT_ACTION.copy,
      });
      const { items, stoppedBecause } = dryRun
        ? { items: planned.items, stoppedBecause: null }
        : await this.#run.execute({
            plan: planned,
            requestId: target.row.id,
            source: source.organization,
            target: target.organization,
            grant: staffCopyGrant(target.row.scopes),
            stillLive: () => this.stopReason({ source, target }),
          });
      if (stoppedBecause !== null) {
        await this.writeAudit({
          bearer,
          source,
          target,
          items,
          action: AUDIT_ACTION.stopped,
          stoppedBecause,
        }).catch(() => undefined);
      }
      await finish(200, null);
      return {
        source: identityOf(source.organization),
        target: identityOf(target.organization),
        dryRun,
        items,
        totals: copyTotals(items),
        stoppedBecause,
      };
    } catch (error) {
      const handled = HandledError.isHandled(error) ? error : null;
      await finish(handled?.httpStatus ?? 500, handled?.code ?? null);
      throw error;
    }
  }

  /** Both approvals, checked: live together, the same agent and operator, the right scopes. */
  private async pairedSides({
    bearer,
    body,
  }: {
    bearer: OpsSession;
    body: StaffAccessCopyBody;
  }): Promise<{ source: Side; target: Side }> {
    const [targetRow] = await this.deps.requests.findById({ id: bearer.requestId });
    if (!targetRow) throw new StaffAccessNotFoundError();
    const sourceRow = await this.sourceRowOf({ token: body.sourceOpsToken });

    assertSourceLive({ row: sourceRow, at: this.deps.now() });
    if (sourceRow.pinnedIp !== bearer.ipAddress) throw new StaffAccessIpMismatchError();
    const sameHands =
      sourceRow.requesterId === targetRow.requesterId &&
      sourceRow.ownerUserId === targetRow.ownerUserId;
    if (!sameHands) throw new StaffCopyApprovalsMismatchError();
    const operators = await this.deps.ops.listPlatformOperators();
    if (!operators.some((operator) => operator.userId === sourceRow.ownerUserId)) {
      throw new StaffAccessOperatorLostError();
    }
    const pair = copyPairOf({ source: sourceRow, target: targetRow });

    const [sourceOrganization, targetOrganization] = await Promise.all([
      this.deps.organizations.findProvisioningSummary(pair.sourceOrganizationId),
      this.deps.organizations.findProvisioningSummary(pair.targetOrganizationId),
    ]);
    if (!sourceOrganization || !targetOrganization) throw new StaffAccessNotFoundError();
    return {
      source: { row: sourceRow, organization: sourceOrganization },
      target: { row: targetRow, organization: targetOrganization },
    };
  }

  /** Rereads both approvals: a revoke, kill switch or lapse on either side stops the copy. */
  private async stopReason({
    source,
    target,
  }: {
    source: Side;
    target: Side;
  }): Promise<string | null> {
    const at = this.deps.now();
    for (const [side, reason] of [
      [source, "source_approval_ended"],
      [target, "target_approval_ended"],
    ] as const) {
      const [row] = await this.deps.requests.findById({ id: side.row.id });
      if (!row || !isLive({ row, at })) return reason;
    }
    return null;
  }

  private async sourceRowOf({ token }: { token: string }): Promise<StaffAccessRequestRow> {
    const parsed = parseToken({ token, prefix: STAFF_ACCESS_OPS_TOKEN_PREFIX });
    if (!parsed) throw new StaffCopySourceInvalidError();
    const [row] = await this.deps.requests.findByOpsTokenLookupId({ lookupId: parsed.lookupId });
    if (
      !row?.hashedOpsToken ||
      !secretMatches({ secret: parsed.secret, hashed: row.hashedOpsToken })
    ) {
      throw new StaffCopySourceInvalidError();
    }
    return row;
  }

  /** One trail row on each session, before anything is read or written; a failure refuses. */
  private async writeTrail({
    bearer,
    source,
    target,
    at,
  }: {
    bearer: OpsSession;
    source: Side;
    target: Side;
    at: Instant;
  }): Promise<string[]> {
    const rows = [source, target].map((side) => ({
      id: generate("staffevent").toString(),
      requestId: side.row.id,
      at,
      method: "POST",
      path: COPY_PATH,
      operation: COPY_OPERATION,
      permissions: ["opsCopy:create"],
      organizationId: side.organization.id,
      projectId: null,
      status: null,
      errorCode: null,
      durationMs: null,
      ipAddress: bearer.ipAddress,
      userAgent: bearer.userAgent,
    }));
    try {
      for (const row of rows) await this.deps.events.create(row);
    } catch {
      throw new StaffAccessAuditUnavailableError();
    }
    return rows.map((row) => row.id);
  }

  /**
   * The copy in both customers' audit logs, with each side's approver, reason and the plan: on a
   * dry run as planned, before a run as the copy, and after a stopped run with what it made.
   */
  private async writeAudit({
    bearer,
    source,
    target,
    items,
    action,
    stoppedBecause,
  }: {
    bearer: OpsSession;
    source: Side;
    target: Side;
    items: readonly StaffAccessCopyItem[];
    action: (typeof AUDIT_ACTION)[keyof typeof AUDIT_ACTION];
    stoppedBecause?: string;
  }): Promise<void> {
    const plan = auditedPlan({
      items,
      outcome: action === AUDIT_ACTION.stopped ? "copied" : "planned",
    });
    try {
      for (const [side, role] of [
        [source, "source"],
        [target, "target"],
      ] as const) {
        await this.deps.auditLog.record({
          organizationId: side.organization.id,
          userId: side.row.ownerUserId,
          actorUserId: side.row.ownerUserId,
          action,
          targetKind: "staffAccess",
          targetId: side.row.id,
          ...(bearer.ipAddress ? { ipAddress: bearer.ipAddress } : {}),
          ...(bearer.userAgent ? { userAgent: bearer.userAgent } : {}),
          metadata: {
            principal: STAFF_ACCESS_PRINCIPAL,
            approvedBy: { id: side.row.ownerUserId },
            reason: side.row.reason,
            role,
            sourceOrganizationId: source.organization.id,
            targetOrganizationId: target.organization.id,
            sourceApproval: source.row.id,
            targetApproval: target.row.id,
            counts: plan.counts,
            items: plan.names,
            monitorsCreatedPaused: true,
            ...(stoppedBecause ? { stoppedBecause } : {}),
          },
        });
      }
    } catch {
      throw new StaffAccessAuditUnavailableError();
    }
  }
}

/** @throws {StaffCopyWindowClosedError} once the source session ended, lapsed or was revoked */
function assertSourceLive({ row, at }: { row: StaffAccessRequestRow; at: Instant }): void {
  if (!isLive({ row, at })) throw new StaffCopyWindowClosedError();
}

function isLive({ row, at }: { row: StaffAccessRequestRow; at: Instant }): boolean {
  return (
    row.status === "redeemed" &&
    row.revokedAt === null &&
    row.accessExpiresAt !== null &&
    !hasPassed({ moment: row.accessExpiresAt, at })
  );
}

/**
 * Each side's scope and organization; a copy goes between two different organizations, and each
 * side's signed approval names the other, so a session pairs only with the copy it was approved
 * for.
 */
function copyPairOf({
  source,
  target,
}: {
  source: StaffAccessRequestRow;
  target: StaffAccessRequestRow;
}): { sourceOrganizationId: string; targetOrganizationId: string } {
  const sourceOrganizationId = source.organizationId;
  const targetOrganizationId = target.organizationId;
  if (
    !sourceOrganizationId ||
    !holdsScopes({ scopes: source.scopes, needed: COPY_SOURCE_SCOPES })
  ) {
    throw new StaffCopyScopeMissingError({ side: "source" });
  }
  if (
    !targetOrganizationId ||
    !holdsScopes({ scopes: target.scopes, needed: COPY_TARGET_SCOPES })
  ) {
    throw new StaffCopyScopeMissingError({ side: "target" });
  }
  if (sourceOrganizationId === targetOrganizationId) throw new StaffCopySameOrganizationError();
  const facing =
    source.counterpartOrganizationId === targetOrganizationId &&
    target.counterpartOrganizationId === sourceOrganizationId;
  if (!facing) throw new StaffCopyDirectionMismatchError();
  return { sourceOrganizationId, targetOrganizationId };
}

function identityOf({ id, slug, name }: OrganizationProvisioningSummary) {
  return { id, slug, name };
}

/** The door answered `opsCopy:create` for an ops session only. */
function opsSessionOf(session: StaffAccessDoorSession): OpsSession {
  if (session.kind !== "ops") throw new StaffAccessNotFoundError();
  return session;
}
