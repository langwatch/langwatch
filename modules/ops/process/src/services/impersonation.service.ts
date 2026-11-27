import { type AuthApi, IMPERSONATION_WINDOW_MS } from "@langwatch/auth-contract";
import {
  CannotImpersonateAdminError,
  CannotImpersonateDeactivatedUserError,
  CannotImpersonateWithoutSecondFactorError,
  CannotReimpersonateWhileImpersonatingError,
  type StartImpersonationInput,
  type StopImpersonationInput,
  type AdminAuditRequest,
} from "@langwatch/ops-contract";
import type { OrganizationApi } from "@langwatch/organization-contract";
import { type Instant, nowInstant } from "@langwatch/time";

import type {
  ImpersonationRepository,
  ImpersonationTarget,
} from "../repositories/impersonation.repository.ts";
import type { AdminAccess } from "./admin-access.service.ts";

export abstract class AdminAuditSink {
  abstract record(input: {
    userId: string;
    /** The customer organization whose audit log shows the row; absent on operator-only acts. */
    organizationId?: string | undefined;
    action: string;
    /** What the row is about; auth matches a window's end to its start by the session. */
    target?: { kind: string; id: string } | undefined;
    args: Record<string, unknown>;
    req: AdminAuditRequest;
  }): Promise<void>;
}

/** Which organizations a person belongs to, asked of organization so each one sees the act. */
export type ImpersonationMemberships = Pick<OrganizationApi, "organizationIdsForMember">;

/** The session's {actor, subject} claims are auth's (D06); ops asks for them through its peer. */
export type ImpersonationSessions = Pick<
  AuthApi,
  "getImpersonation" | "startImpersonation" | "stopImpersonation"
>;

interface ImpersonationServiceOptions {
  repository: ImpersonationRepository;
  sessions: ImpersonationSessions;
  memberships: ImpersonationMemberships;
  access: AdminAccess;
  audit: AdminAuditSink;
  now?: (() => Instant) | undefined;
}

export class ImpersonationService {
  private readonly repository: ImpersonationRepository;
  private readonly sessions: ImpersonationSessions;
  private readonly memberships: ImpersonationMemberships;
  private readonly access: AdminAccess;
  private readonly audit: AdminAuditSink;
  private readonly now: () => Instant;

  private constructor(deps: {
    repository: ImpersonationRepository;
    sessions: ImpersonationSessions;
    memberships: ImpersonationMemberships;
    access: AdminAccess;
    audit: AdminAuditSink;
    now: () => Instant;
  }) {
    this.repository = deps.repository;
    this.sessions = deps.sessions;
    this.memberships = deps.memberships;
    this.access = deps.access;
    this.audit = deps.audit;
    this.now = deps.now;
  }

  static create(options: ImpersonationServiceOptions): ImpersonationService {
    return new ImpersonationService({
      repository: options.repository,
      sessions: options.sessions,
      memberships: options.memberships,
      access: options.access,
      audit: options.audit,
      now: options.now ?? nowInstant,
    });
  }

  async start(input: StartImpersonationInput): Promise<void> {
    await this.assertSessionIsNotAlreadyImpersonating(input);

    const target = await this.repository.getTarget(input.userIdToImpersonate);

    if (target.deactivatedAt) {
      throw new CannotImpersonateDeactivatedUserError(target.id);
    }

    if (await this.access.isAdmin(target)) {
      throw new CannotImpersonateAdminError(target.id);
    }

    await this.assertOperatorCanProveSecondFactor({
      operatorUserId: input.impersonatorUserId,
      target,
    });

    // Taken before the start rows are written, so auth finds them inside the window it reads.
    const expiresAt = this.now().add({ milliseconds: IMPERSONATION_WINDOW_MS });
    const organizationIds = await this.memberships.organizationIdsForMember({ userId: target.id });
    // One row per organization so each customer reads it in their own audit log.
    for (const organizationId of organizationIds.length > 0 ? organizationIds : [undefined]) {
      await this.audit.record({
        userId: input.impersonatorUserId,
        organizationId,
        action: "admin/impersonate",
        target: { kind: "session", id: input.sessionId },
        args: { userIdToImpersonate: target.id, reason: input.reason },
        req: input.req,
      });
    }

    await this.sessions.startImpersonation({
      sessionId: input.sessionId,
      actorUserId: input.impersonatorUserId,
      subjectUserId: target.id,
      reason: input.reason,
      expiresAt,
    });
  }

  /**
   * Read FIRST, so a refused hop writes no audit entry and touches no session
   * row. Auth reads a lapsed claim, and one naming the operator, as an
   * ordinary session: neither is an impersonation to stop.
   */
  private async assertSessionIsNotAlreadyImpersonating(
    input: StartImpersonationInput,
  ): Promise<void> {
    const state = await this.sessions.getImpersonation({ sessionId: input.sessionId });
    if (state.kind === "none") return;

    throw new CannotReimpersonateWhileImpersonatingError();
  }

  /**
   * Borrowing access inside an organization that requires a second factor
   * takes one on the OPERATOR'S own account: impersonation would otherwise
   * reach its data while holding less than its own members must hold.
   */
  private async assertOperatorCanProveSecondFactor({
    operatorUserId,
    target,
  }: {
    operatorUserId: string;
    target: ImpersonationTarget;
  }): Promise<void> {
    if (target.mfaRequiredOrganizationSlugs.length === 0) {
      return;
    }

    if (await this.repository.hasSecondFactor(operatorUserId)) {
      return;
    }

    throw new CannotImpersonateWithoutSecondFactorError(
      `impersonate: operator ${operatorUserId} has no second factor; target ${
        target.id
      } belongs to ${target.mfaRequiredOrganizationSlugs.join(", ")}`,
    );
  }

  async stop(input: StopImpersonationInput): Promise<void> {
    await this.sessions.stopImpersonation({ sessionId: input.sessionId });
  }
}
