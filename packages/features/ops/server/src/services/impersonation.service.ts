import {
  CannotImpersonateAdminError,
  CannotImpersonateDeactivatedUserError,
  type StartImpersonationInput,
  type StopImpersonationInput,
  UserToImpersonateNotFoundError,
} from "@langwatch/ops-contract";
import type { AdminAuditRequest } from "@langwatch/ops-contract";
import type { AdminAccess } from "./admin-access.service";

const IMPERSONATION_TTL_MS = 60 * 60 * 1_000;

export interface ImpersonationTarget {
  id: string;
  name: string | null;
  email: string | null;
  image: string | null;
  deactivatedAt: Date | null;
}

export interface ImpersonationWindow {
  id: string;
  name: string | null;
  email: string | null;
  image: string | null;
  expires: Date;
}

export abstract class ImpersonationRepository {
  abstract tryFindTarget(userId: string): Promise<ImpersonationTarget | null>;
  abstract setWindow(sessionId: string, window: ImpersonationWindow): Promise<void>;
  abstract clearWindow(sessionId: string): Promise<void>;
}

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
  now?: (() => Date) | undefined;
}

export class ImpersonationService {
  private constructor(
    private readonly repository: ImpersonationRepository,
    private readonly access: AdminAccess,
    private readonly audit: AdminAuditSink,
    private readonly now: () => Date,
  ) {}

  static create(options: ImpersonationServiceOptions): ImpersonationService {
    return new ImpersonationService(
      options.repository,
      options.access,
      options.audit,
      options.now ?? (() => new Date()),
    );
  }

  async start(input: StartImpersonationInput): Promise<void> {
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
      expires: new Date(this.now().getTime() + IMPERSONATION_TTL_MS),
    });
  }

  async stop(input: StopImpersonationInput): Promise<void> {
    await this.repository.clearWindow(input.sessionId);
  }
}
