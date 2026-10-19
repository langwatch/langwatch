import type { AuthApi } from "@langwatch/auth-contract";
import {
  CannotImpersonateAdminError,
  CannotImpersonateDeactivatedUserError,
  CannotImpersonateWithoutSecondFactorError,
  CannotReimpersonateWhileImpersonatingError,
  type StartImpersonationInput,
  type StopImpersonationInput,
  type AdminAuditRequest,
} from "@langwatch/ops-contract";
import { type Instant, nowInstant } from "@langwatch/time";

import type {
  ImpersonationRepository,
  ImpersonationTarget,
} from "../repositories/impersonation.repository.ts";
import type { AdminAccess } from "./admin-access.service.ts";

const IMPERSONATION_TTL_MS = 60 * 60 * 1_000;

export abstract class AdminAuditSink {
  abstract record(input: {
    userId: string;
    action: string;
    args: Record<string, unknown>;
    req: AdminAuditRequest;
  }): Promise<void>;
}

/** The session's {actor, subject} claims are auth's (D06); ops asks for them through its peer. */
export type ImpersonationSessions = Pick<
  AuthApi,
  "getImpersonation" | "startImpersonation" | "stopImpersonation"
>;

interface ImpersonationServiceOptions {
  repository: ImpersonationRepository;
  sessions: ImpersonationSessions;
  access: AdminAccess;
  audit: AdminAuditSink;
  now?: (() => Instant) | undefined;
}

export class ImpersonationService {
  private readonly repository: ImpersonationRepository;
  private readonly sessions: ImpersonationSessions;
  private readonly access: AdminAccess;
  private readonly audit: AdminAuditSink;
  private readonly now: () => Instant;

  private constructor(deps: {
    repository: ImpersonationRepository;
    sessions: ImpersonationSessions;
    access: AdminAccess;
    audit: AdminAuditSink;
    now: () => Instant;
  }) {
    this.repository = deps.repository;
    this.sessions = deps.sessions;
    this.access = deps.access;
    this.audit = deps.audit;
    this.now = deps.now;
  }

  static create(options: ImpersonationServiceOptions): ImpersonationService {
    return new ImpersonationService({
      repository: options.repository,
      sessions: options.sessions,
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

    await this.audit.record({
      userId: input.impersonatorUserId,
      action: "admin/impersonate",
      args: { userIdToImpersonate: target.id, reason: input.reason },
      req: input.req,
    });

    await this.sessions.startImpersonation({
      sessionId: input.sessionId,
      actorUserId: input.impersonatorUserId,
      subjectUserId: target.id,
      reason: input.reason,
      expiresAt: this.now().add({ milliseconds: IMPERSONATION_TTL_MS }),
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
