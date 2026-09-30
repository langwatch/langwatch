import { describe, expect, it } from "vitest";

import { organizationAuditLogPageSchema } from "../organization.responses.ts";

describe("organizationAuditLogPageSchema", () => {
  /** @scenario "An audit log entry declares the before and after states main served" */
  it("accepts an entry carrying before and after states", () => {
    const page = {
      totalCount: 1,
      auditLogs: [
        {
          id: "audit_1",
          createdAt: new Date("2026-09-30T00:00:00.000Z"),
          userId: "user_1",
          organizationId: "organization_1",
          projectId: null,
          action: "gateway.budget.update",
          payload: { limit: 2 },
          ipAddress: null,
          userAgent: null,
          error: null,
          args: { before: { limit: 1 }, after: { limit: 2 } },
          user: null,
          project: null,
          source: "gateway",
          targetKind: "budget",
          targetId: "budget_1",
          before: { limit: 1 },
          after: { limit: 2 },
        },
      ],
    };

    expect(organizationAuditLogPageSchema.validate(page)).toBe(true);
  });
});
