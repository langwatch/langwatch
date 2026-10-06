import type { SessionImpersonation, SessionImpersonationState } from "@langwatch/auth-contract";
import {
  CannotImpersonateAdminError,
  CannotImpersonateDeactivatedUserError,
  CannotImpersonateWithoutSecondFactorError,
  UserToImpersonateNotFoundError,
} from "@langwatch/ops-contract";
import { Temporal } from "@langwatch/time";
import { describe, expect, it } from "vitest";

import { platformOperatorAuthz } from "../../app/__tests__/ops.fixture.ts";
import {
  ImpersonationRepository,
  type ImpersonationTarget,
} from "../../repositories/impersonation.repository.ts";
import { AdminAccessService } from "../admin-access.service.ts";
import {
  AdminAuditSink,
  ImpersonationService,
  type ImpersonationSessions,
} from "../impersonation.service.ts";

/** Auth's claims as ops sees them through its peer: `window` is the live impersonation, if any. */
class InMemoryImpersonationRepository
  extends ImpersonationRepository
  implements ImpersonationSessions
{
  window: SessionImpersonation | null = null;
  operatorsAsked: string[] = [];
  targetsAsked: string[] = [];

  constructor(
    private readonly target: ImpersonationTarget | null,
    private readonly operatorHasSecondFactor = false,
  ) {
    super();
  }

  getTarget(userId: string): Promise<ImpersonationTarget> {
    this.targetsAsked.push(userId);
    if (!this.target) return Promise.reject(new UserToImpersonateNotFoundError(userId));
    return Promise.resolve(this.target);
  }

  hasSecondFactor(userId: string): Promise<boolean> {
    this.operatorsAsked.push(userId);
    return Promise.resolve(this.operatorHasSecondFactor);
  }

  getImpersonation(): Promise<SessionImpersonationState> {
    return Promise.resolve(
      this.window ? { kind: "impersonating", impersonation: this.window } : { kind: "none" },
    );
  }

  startImpersonation({
    sessionId: _sessionId,
    ...claims
  }: SessionImpersonation & { sessionId: string; reason: string }): Promise<void> {
    this.window = claims;
    return Promise.resolve();
  }

  stopImpersonation(): Promise<void> {
    this.window = null;
    return Promise.resolve();
  }
}

class RecordingAuditSink extends AdminAuditSink {
  readonly entries: {
    userId: string;
    action: string;
    args: Record<string, unknown>;
    req: unknown;
  }[] = [];

  record(entry: (typeof this.entries)[number]): Promise<void> {
    this.entries.push(entry);
    return Promise.resolve();
  }
}

const target = (overrides: Partial<ImpersonationTarget> = {}): ImpersonationTarget => ({
  id: "user_target",
  name: "Target",
  email: "target@example.com",
  image: null,
  deactivatedAt: null,
  mfaRequiredOrganizationSlugs: [],
  ...overrides,
});

const PLATFORM_OPERATOR_ID = "user_platform_operator";

const platformGrants = platformOperatorAuthz({ holders: { [PLATFORM_OPERATOR_ID]: ["ops:view"] } });

const serviceFor = (repository: InMemoryImpersonationRepository) => {
  const audit = new RecordingAuditSink();
  return {
    audit,
    service: ImpersonationService.create({
      repository,
      sessions: repository,
      access: AdminAccessService.create({
        authz: platformGrants,
        users: { findByEmail: async () => null },
      }),
      audit,
      now: () => Temporal.Instant.from("2026-01-01T00:00:00.000Z"),
    }),
  };
};

const input = {
  sessionId: "session_1",
  impersonatorUserId: "user_admin",
  userIdToImpersonate: "user_target",
  reason: "Debugging trace 42",
  req: { headers: {} },
};

describe("ImpersonationService", () => {
  /**
   * @scenario "A healthy target receives a bounded session window"
   * @scenario Starting an impersonation still takes a reason
   */
  it("audits before installing a one-hour impersonation window", async () => {
    const repository = new InMemoryImpersonationRepository(target());
    const { audit, service } = serviceFor(repository);
    await service.start(input);
    expect(audit.entries).toEqual([
      {
        userId: "user_admin",
        action: "admin/impersonate",
        args: {
          userIdToImpersonate: "user_target",
          reason: "Debugging trace 42",
        },
        req: input.req,
      },
    ]);
    expect(repository.window).toEqual({
      actorUserId: "user_admin",
      subjectUserId: "user_target",
      reason: "Debugging trace 42",
      expiresAt: Temporal.Instant.from("2026-01-01T01:00:00.000Z"),
    });
  });

  /** @scenario An administrator cannot impersonate another administrator */
  /** @scenario A deactivated account cannot be impersonated */
  /** @scenario An account that does not exist is not impersonated */
  it("rejects missing, deactivated, and platform-admin targets", async () => {
    await expect(
      serviceFor(new InMemoryImpersonationRepository(null)).service.start(input),
    ).rejects.toBeInstanceOf(UserToImpersonateNotFoundError);
    await expect(
      serviceFor(
        new InMemoryImpersonationRepository(
          target({ deactivatedAt: Temporal.Instant.from("2025-01-01T00:00:00Z") }),
        ),
      ).service.start(input),
    ).rejects.toBeInstanceOf(CannotImpersonateDeactivatedUserError);
    await expect(
      serviceFor(
        new InMemoryImpersonationRepository(target({ id: PLATFORM_OPERATOR_ID })),
      ).service.start(input),
    ).rejects.toBeInstanceOf(CannotImpersonateAdminError);
  });

  /** @scenario "An admin cannot impersonate another admin" */
  it("reports cannot_impersonate_admin and leaves the session as it was", async () => {
    const repository = new InMemoryImpersonationRepository(target({ id: PLATFORM_OPERATOR_ID }));
    const { audit, service } = serviceFor(repository);

    await expect(service.start(input)).rejects.toMatchObject({ code: "cannot_impersonate_admin" });

    expect(repository.window).toBeNull();
    expect(audit.entries).toEqual([]);
  });

  describe("when the target belongs to an organization that requires a second factor", () => {
    /** @scenario "Impersonating into an organization that requires it takes the operator's own" */
    it("refuses an operator without one, and opens no window", async () => {
      const repository = new InMemoryImpersonationRepository(
        target({ mfaRequiredOrganizationSlugs: ["acme"] }),
        false,
      );
      const { audit, service } = serviceFor(repository);

      await expect(service.start(input)).rejects.toBeInstanceOf(
        CannotImpersonateWithoutSecondFactorError,
      );
      expect(repository.window).toBeNull();
      expect(audit.entries).toEqual([]);
      expect(repository.operatorsAsked).toEqual(["user_admin"]);
    });

    /** @scenario "Impersonating into an organization that requires it takes the operator's own" */
    it("allows an operator who has one of their own", async () => {
      const repository = new InMemoryImpersonationRepository(
        target({ mfaRequiredOrganizationSlugs: ["acme"] }),
        true,
      );
      const { service } = serviceFor(repository);

      await service.start(input);

      expect(repository.window?.subjectUserId).toBe("user_target");
    });

    /** @scenario "Looking up the requirement decides the request rather than failing it" */
    it("never asks about the operator when no organization requires one", async () => {
      const repository = new InMemoryImpersonationRepository(target(), false);
      const { service } = serviceFor(repository);

      await service.start(input);

      expect(repository.operatorsAsked).toEqual([]);
      expect(repository.window?.subjectUserId).toBe("user_target");
    });
  });

  describe("when the acting session is already impersonating somebody", () => {
    const openWindow = (): SessionImpersonation => ({
      actorUserId: "user_admin",
      subjectUserId: "user_other_subject",
      reason: "Earlier ticket",
      expiresAt: Temporal.Instant.from("2026-01-01T00:30:00.000Z"),
    });

    /** @scenario An operator already impersonating cannot jump straight to another account */
    /** @scenario "An operator cannot hop from one impersonation straight into another" */
    it("refuses the hop before looking the target up or auditing anything", async () => {
      const repository = new InMemoryImpersonationRepository(target());
      repository.window = openWindow();
      const { audit, service } = serviceFor(repository);

      await expect(service.start(input)).rejects.toMatchObject({
        code: "cannot_reimpersonate_while_impersonating",
      });
      expect(repository.targetsAsked).toEqual([]);
      expect(audit.entries).toEqual([]);
      expect(repository.window).toEqual(openWindow());
    });

    it("starts once auth reads the session as the operator's own again", async () => {
      const repository = new InMemoryImpersonationRepository(target());
      await serviceFor(repository).service.start(input);
      expect(repository.window?.subjectUserId).toBe("user_target");
    });
  });

  it("clears an existing window idempotently", async () => {
    const repository = new InMemoryImpersonationRepository(target());
    const { service } = serviceFor(repository);
    await service.start(input);
    await service.stop({ sessionId: "session_1" });
    await service.stop({ sessionId: "session_1" });
    expect(repository.window).toBeNull();
  });
});
