import type { PrismaClient } from "@prisma/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearAuthzGrantsCacheForTests, collectGrantsCached } from "../cache";

function makePrisma() {
  return {
    organizationUser: {
      findFirst: vi.fn().mockResolvedValue({ role: "MEMBER" }),
    },
    roleBinding: { findMany: vi.fn().mockResolvedValue([]) },
    teamUser: { findMany: vi.fn().mockResolvedValue([]) },
    customRole: { findMany: vi.fn().mockResolvedValue([]) },
  };
}

const principal = { type: "user", id: "alice" } as const;
const ORG = "org-1";

describe("authz grants cache", () => {
  const originalFlag = process.env.AUTHZ_EPOCH_CACHE;

  beforeEach(() => {
    clearAuthzGrantsCacheForTests();
    process.env.AUTHZ_EPOCH_CACHE = "1";
  });
  afterEach(() => {
    if (originalFlag === undefined) delete process.env.AUTHZ_EPOCH_CACHE;
    else process.env.AUTHZ_EPOCH_CACHE = originalFlag;
  });

  describe("given a stable epoch", () => {
    /** @scenario "Repeated checks with unchanged grants read nothing from the database" */
    it("collects once and serves the second read from memory", async () => {
      const prisma = makePrisma();
      const epochReader = vi.fn().mockResolvedValue(4);

      await collectGrantsCached({
        prisma: prisma as unknown as PrismaClient,
        principal,
        organizationId: ORG,
        epochReader,
      });
      await collectGrantsCached({
        prisma: prisma as unknown as PrismaClient,
        principal,
        organizationId: ORG,
        epochReader,
      });

      expect(prisma.organizationUser.findFirst).toHaveBeenCalledTimes(1);
    });
  });

  describe("when a grant write bumps the epoch", () => {
    /** @scenario "Revoking a binding takes effect on the caller's next request" */
    it("recollects on the next read", async () => {
      const prisma = makePrisma();
      const epochReader = vi
        .fn()
        .mockResolvedValueOnce(4)
        .mockResolvedValueOnce(5);

      await collectGrantsCached({
        prisma: prisma as unknown as PrismaClient,
        principal,
        organizationId: ORG,
        epochReader,
      });
      await collectGrantsCached({
        prisma: prisma as unknown as PrismaClient,
        principal,
        organizationId: ORG,
        epochReader,
      });

      expect(prisma.organizationUser.findFirst).toHaveBeenCalledTimes(2);
    });
  });

  describe("when the epoch store is unavailable", () => {
    it("collects fresh every time — never stale, just slower", async () => {
      const prisma = makePrisma();
      const epochReader = vi.fn().mockResolvedValue(null);

      await collectGrantsCached({
        prisma: prisma as unknown as PrismaClient,
        principal,
        organizationId: ORG,
        epochReader,
      });
      await collectGrantsCached({
        prisma: prisma as unknown as PrismaClient,
        principal,
        organizationId: ORG,
        epochReader,
      });

      expect(prisma.organizationUser.findFirst).toHaveBeenCalledTimes(2);
    });
  });

  describe("when the flag is off", () => {
    it("bypasses the cache entirely", async () => {
      process.env.AUTHZ_EPOCH_CACHE = "0";
      const prisma = makePrisma();
      const epochReader = vi.fn().mockResolvedValue(4);

      await collectGrantsCached({
        prisma: prisma as unknown as PrismaClient,
        principal,
        organizationId: ORG,
        epochReader,
      });
      await collectGrantsCached({
        prisma: prisma as unknown as PrismaClient,
        principal,
        organizationId: ORG,
        epochReader,
      });

      expect(epochReader).not.toHaveBeenCalled();
      expect(prisma.organizationUser.findFirst).toHaveBeenCalledTimes(2);
    });
  });
});
