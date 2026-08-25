import { describe, expect, it, vi } from "vitest";
import { AuditLogAdapter } from "../src";

describe("DefaultAuditLogService", () => {
  it("normalises legacy request context and persists one record", async () => {
    const entries: unknown[] = [];
    const auditLog = AuditLogAdapter.create({
      prisma: {
        auditLog: {
          create: vi.fn(async ({ data }: { data: unknown }) => {
            entries.push(data);
          }),
        },
      },
    });

    await auditLog.record({
      userId: "user_1",
      organizationId: "org_1",
      action: "project.update",
      args: { name: "Renamed" },
      req: {
        headers: {
          "user-agent": "vitest",
          "x-forwarded-for": "192.0.2.5, 10.0.0.1",
        },
      },
    });

    expect(entries).toEqual([
      expect.objectContaining({
        userId: "user_1",
        ipAddress: "192.0.2.5",
        userAgent: "vitest",
      }),
    ]);
  });
});
