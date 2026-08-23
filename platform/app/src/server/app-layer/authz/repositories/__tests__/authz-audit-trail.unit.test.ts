import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "~/generated/prisma/client";
import { PrismaAuthzAuditTrailRepository } from "../authz-audit-trail.prisma.repository";

const ROW = {
  id: "authz-evt-evt_2Zk",
  createdAt: new Date(1_700_000_000_000),
  userId: "user_admin",
  organizationId: "org_acme",
  action: "authz.grants.attach",
  metadata: { grantId: "grant_1", source: "grants-service" },
};

function makePrisma() {
  const createMany = vi.fn(async () => ({ count: 1 }));
  const update = vi.fn();
  const upsert = vi.fn();
  return {
    prisma: {
      auditLog: { createMany, update, upsert },
    } as unknown as PrismaClient,
    createMany,
    update,
    upsert,
  };
}

describe("PrismaAuthzAuditTrailRepository", () => {
  describe("when a row is inserted", () => {
    it("writes the AuditLog columns the subscriber derived", async () => {
      const { prisma, createMany } = makePrisma();
      await new PrismaAuthzAuditTrailRepository(prisma).insert(ROW);

      expect(createMany).toHaveBeenCalledTimes(1);
      expect(createMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: [
            {
              id: ROW.id,
              createdAt: ROW.createdAt,
              userId: ROW.userId,
              organizationId: ROW.organizationId,
              action: ROW.action,
              metadata: ROW.metadata,
            },
          ],
        }),
      );
    });

    it("asks for ON CONFLICT DO NOTHING, so a re-delivery is a no-op", async () => {
      const { prisma, createMany } = makePrisma();
      await new PrismaAuthzAuditTrailRepository(prisma).insert(ROW);

      expect(createMany).toHaveBeenCalledWith(
        expect.objectContaining({ skipDuplicates: true }),
      );
    });

    it("never updates an existing row", async () => {
      const { prisma, update, upsert } = makePrisma();
      await new PrismaAuthzAuditTrailRepository(prisma).insert(ROW);
      await new PrismaAuthzAuditTrailRepository(prisma).insert(ROW);

      expect(update).not.toHaveBeenCalled();
      expect(upsert).not.toHaveBeenCalled();
    });
  });
});
