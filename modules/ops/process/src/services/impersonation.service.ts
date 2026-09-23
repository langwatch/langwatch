import {
  CannotImpersonateAdminError,
  CannotImpersonateDeactivatedUserError,
  CannotImpersonateWithoutSecondFactorError,
  CannotReimpersonateWhileImpersonatingError,
  type StartImpersonationInput,
  type StopImpersonationInput,
  UserToImpersonateNotFoundError,
  type AdminAuditRequest,
} from "@langwatch/ops-contract";
import { type Instant, nowInstant, Temporal } from "@langwatch/time";

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

export interface ImpersonationServiceOptions {
  repository: ImpersonationRepository;
  access: AdminAccess;
  audit: AdminAuditSink;
  now?: (() => Instant) | undefined;
}

export class ImpersonationService {
  private constructor(
    private readonly repository: ImpersonationRepository,
    private readonly access: AdminAccess,
    private readonly audit: AdminAuditSink,
    private readonly now: () => Instant,
  ) {}

  static create(options: ImpersonationServiceOptions): ImpersonationService {
    return new ImpersonationService(
      options.repository,
      options.access,
      options.audit,
      options.now ?? nowInstant,
    );
  }

  async start(input: StartImpersonationInput): Promise<void> {
    await this.assertSessionIsNotAlreadyImpersonating(input);

    const target = await this.repository.tryFindTarget(input.userIdToImpersonate);
    if (!target) {
      throw new UserToImpersonateNotFoundError(input.userIdToImpersonate);
    }

    if (target.deactivatedAt) {
      throw new CannotImpersonateDeactivatedUserError(target.id);
    }

    if (this.access.isAdmin(target)) {
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

    await this.repository.setWindow(input.sessionId, {
      id: target.id,
      name: target.name,
      email: target.email,
      image: target.image,
      expires: this.now().add({ milliseconds: IMPERSONATION_TTL_MS }),
    });
  }

  /**
   * Read FIRST, so a refused hop writes no audit entry and touches no session
   * row. A lapsed window reads as an ordinary session, and so does one naming
   * the operator: neither is an impersonation to stop.
   */
  private async assertSessionIsNotAlreadyImpersonating(
    input: StartImpersonationInput,
  ): Promise<void> {
    const window = await this.repository.findWindow(input.sessionId);
    if (!window) return;
    if (window.id === input.impersonatorUserId) return;
    if (Temporal.Instant.compare(window.expires, this.now()) <= 0) return;

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
    await this.repository.clearWindow(input.sessionId);
  }
}
