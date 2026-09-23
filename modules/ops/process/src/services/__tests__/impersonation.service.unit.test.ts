import {
  CannotImpersonateAdminError,
  CannotImpersonateDeactivatedUserError,
  CannotImpersonateWithoutSecondFactorError,
  CannotReimpersonateWhileImpersonatingError,
  UserToImpersonateNotFoundError,
} from "@langwatch/ops-contract";
import { Temporal } from "@langwatch/time";
import { describe, expect, it } from "vitest";

import {
  ImpersonationRepository,
  type ImpersonationTarget,
  type ImpersonationWindow,
} from "../../repositories/impersonation.repository.ts";
import { AdminAccessService } from "../admin-access.service.ts";
import { AdminAuditSink, ImpersonationService } from "../impersonation.service.ts";

class InMemoryImpersonationRepository extends ImpersonationRepository {
  window: ImpersonationWindow | null = null;
  operatorsAsked: string[] = [];
  targetsAsked: string[] = [];

  constructor(
    private readonly target: ImpersonationTarget | null,
    private readonly operatorHasSecondFactor = false,
  ) {
    super();
  }

  tryFindTarget(userId: string): Promise<ImpersonationTarget | null> {
    this.targetsAsked.push(userId);
    return Promise.resolve(this.target);
  }

  findWindow(): Promise<ImpersonationWindow | null> {
    return Promise.resolve(this.window);
  }

  hasSecondFactor(userId: string): Promise<boolean> {
    this.operatorsAsked.push(userId);
    return Promise.resolve(this.operatorHasSecondFactor);
  }

  setWindow(_sessionId: string, window: ImpersonationWindow): Promise<void> {
    this.window = window;
    return Promise.resolve();
  }

  clearWindow(): Promise<void> {
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

const serviceFor = (repository: InMemoryImpersonationRepository) => {
  const audit = new RecordingAuditSink();
  return {
    audit,
    service: ImpersonationService.create({
      repository,
      access: AdminAccessService.create({
        adminEmails: ["root@langwatch.ai"],
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
  /** @scenario "A healthy target receives a bounded session window" */
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
    expect(repository.window?.expires.toString({ fractionalSecondDigits: 3 })).toBe(
      "2026-01-01T01:00:00.000Z",
    );
  });

  /** @scenario "An admin cannot impersonate another admin" */
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
        new InMemoryImpersonationRepository(target({ email: "Root@Langwatch.ai" })),
      ).service.start(input),
    ).rejects.toBeInstanceOf(CannotImpersonateAdminError);
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

      expect(repository.window?.id).toBe("user_target");
    });

    /** @scenario "Looking up the requirement decides the request rather than failing it" */
    it("never asks about the operator when no organization requires one", async () => {
      const repository = new InMemoryImpersonationRepository(target(), false);
      const { service } = serviceFor(repository);

      await service.start(input);

      expect(repository.operatorsAsked).toEqual([]);
      expect(repository.window?.id).toBe("user_target");
    });
  });

  describe("when the acting session is already impersonating somebody", () => {
    const openWindow = (overrides: Partial<ImpersonationWindow> = {}): ImpersonationWindow => ({
      id: "user_other_subject",
      name: "Other",
      email: "other@example.com",
      image: null,
      expires: Temporal.Instant.from("2026-01-01T00:30:00.000Z"),
      ...overrides,
    });

    /** @scenario "An operator cannot hop from one impersonation straight into another" */
    it("refuses the hop before looking the target up or auditing anything", async () => {
      const repository = new InMemoryImpersonationRepository(target());
      repository.window = openWindow();
      const { audit, service } = serviceFor(repository);

      await expect(service.start(input)).rejects.toBeInstanceOf(
        CannotReimpersonateWhileImpersonatingError,
      );
      expect(repository.targetsAsked).toEqual([]);
      expect(audit.entries).toEqual([]);
      expect(repository.window).toEqual(openWindow());
    });

    /** @scenario "An operator cannot hop from one impersonation straight into another" */
    it("allows the start once the window has lapsed or names the operator themselves", async () => {
      const lapsed = new InMemoryImpersonationRepository(target());
      lapsed.window = openWindow({ expires: Temporal.Instant.from("2025-12-31T23:59:59.000Z") });
      await serviceFor(lapsed).service.start(input);
      expect(lapsed.window?.id).toBe("user_target");

      const own = new InMemoryImpersonationRepository(target());
      own.window = openWindow({ id: "user_admin" });
      await serviceFor(own).service.start(input);
      expect(own.window?.id).toBe("user_target");
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
