import {
  CannotImpersonateAdminError,
  CannotImpersonateDeactivatedUserError,
  UserToImpersonateNotFoundError,
} from "@langwatch/enterprise-admin-contract";
import { describe, expect, it } from "vitest";
import {
  AdminAccessService,
  AdminAuditSink,
  ImpersonationRepository,
  ImpersonationService,
  type ImpersonationTarget,
  type ImpersonationWindow,
} from "../src";

class InMemoryImpersonationRepository extends ImpersonationRepository {
  window: ImpersonationWindow | null = null;

  constructor(private readonly target: ImpersonationTarget | null) {
    super();
  }

  findTarget(): Promise<ImpersonationTarget | null> {
    return Promise.resolve(this.target);
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
  readonly entries: Array<{
    userId: string;
    action: string;
    args: Record<string, unknown>;
    req: unknown;
  }> = [];

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
      now: () => new Date("2026-01-01T00:00:00.000Z"),
    }),
  };
};

const input = {
  sessionId: "session_1",
  impersonatorUserId: "user_admin",
  userIdToImpersonate: "user_target",
  reason: "Debugging trace 42",
  req: { path: "/api/admin/impersonate" },
};

describe("ImpersonationService", () => {
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
    expect(repository.window?.expires.toISOString()).toBe(
      "2026-01-01T01:00:00.000Z",
    );
  });

  it("rejects missing, deactivated, and platform-admin targets", async () => {
    await expect(
      serviceFor(new InMemoryImpersonationRepository(null)).service.start(input),
    ).rejects.toBeInstanceOf(UserToImpersonateNotFoundError);
    await expect(
      serviceFor(
        new InMemoryImpersonationRepository(
          target({ deactivatedAt: new Date("2025-01-01") }),
        ),
      ).service.start(input),
    ).rejects.toBeInstanceOf(CannotImpersonateDeactivatedUserError);
    await expect(
      serviceFor(
        new InMemoryImpersonationRepository(
          target({ email: "Root@Langwatch.ai" }),
        ),
      ).service.start(input),
    ).rejects.toBeInstanceOf(CannotImpersonateAdminError);
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
