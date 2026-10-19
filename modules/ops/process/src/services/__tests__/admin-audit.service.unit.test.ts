import type { AuditLogApi } from "@langwatch/audit-log-contract";
import type { SessionImpersonation, SessionImpersonationState } from "@langwatch/auth-contract";
import { Temporal } from "@langwatch/time";
import { describe, expect, it, vi } from "vitest";

import { platformOperatorAuthz } from "../../app/__tests__/ops.fixture.ts";
import {
  ImpersonationRepository,
  type ImpersonationTarget,
} from "../../repositories/impersonation.repository.ts";
import { AdminAccessService } from "../admin-access.service.ts";
import { AdminAuditService } from "../admin-audit.service.ts";
import { ImpersonationService, type ImpersonationSessions } from "../impersonation.service.ts";

const TARGET: ImpersonationTarget = {
  id: "user_target",
  name: "Target",
  email: "target@example.com",
  image: null,
  deactivatedAt: null,
  mfaRequiredOrganizationSlugs: [],
};

class OneTargetRepository extends ImpersonationRepository implements ImpersonationSessions {
  window: SessionImpersonation | null = null;

  getTarget(): Promise<ImpersonationTarget> {
    return Promise.resolve(TARGET);
  }

  hasSecondFactor(): Promise<boolean> {
    return Promise.resolve(false);
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

describe("AdminAuditService", () => {
  /** @scenario "Starting an impersonation is recorded on the shared audit log" */
  it("records the impersonation on the audit log with actor, target and request", async () => {
    const record = vi.fn<AuditLogApi["record"]>(async () => ({ id: "audit_1", occurredAt: 0 }));
    const repository = new OneTargetRepository();
    const service = ImpersonationService.create({
      repository,
      sessions: repository,
      access: AdminAccessService.create({
        authz: platformOperatorAuthz({ holders: { user_operator: ["ops:view"] } }),
        users: { findByEmail: async () => null },
      }),
      audit: AdminAuditService.create({ auditLog: { record } }),
      now: () => Temporal.Instant.from("2026-01-01T00:00:00.000Z"),
    });

    await service.start({
      sessionId: "session_1",
      impersonatorUserId: "user_operator",
      userIdToImpersonate: TARGET.id,
      reason: "Debugging trace 42",
      req: { headers: { "user-agent": ["agent/1", "agent/2"] }, remoteAddress: "203.0.113.7" },
    });

    expect(record).toHaveBeenCalledTimes(1);
    expect(record).toHaveBeenCalledWith({
      userId: "user_operator",
      action: "admin/impersonate",
      args: { userIdToImpersonate: TARGET.id, reason: "Debugging trace 42" },
      ipAddress: "203.0.113.7",
      userAgent: "agent/1",
    });
    expect(repository.window?.subjectUserId).toBe(TARGET.id);
  });

  it("refuses the impersonation when the audit log cannot record it", async () => {
    const repository = new OneTargetRepository();
    const service = ImpersonationService.create({
      repository,
      sessions: repository,
      access: AdminAccessService.create({
        authz: platformOperatorAuthz({ holders: {} }),
        users: { findByEmail: async () => null },
      }),
      audit: AdminAuditService.create({
        auditLog: { record: async () => Promise.reject(new Error("audit log unavailable")) },
      }),
    });

    await expect(
      service.start({
        sessionId: "session_1",
        impersonatorUserId: "user_operator",
        userIdToImpersonate: TARGET.id,
        reason: "Debugging",
        req: { headers: {} },
      }),
    ).rejects.toThrow("audit log unavailable");
    expect(repository.window).toBeNull();
  });
});
