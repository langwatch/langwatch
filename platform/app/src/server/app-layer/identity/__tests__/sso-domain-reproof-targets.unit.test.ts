import { describe, expect, it, vi } from "vitest";
import { PrismaSsoDomainReproofTargets } from "../sso-self-serve-adapters";

const proof = (domain: string) => ({
  domain,
  method: "dns-txt",
  actorId: "user_admin",
  verifiedAtMs: 1_725_000_000_000,
  proofState: "VERIFIED",
  firstAbsentAtMs: null,
  graceEndsAtMs: null,
  tokenHash: `sha256:${domain}`,
});

const connection = (id: string, domain: string) => ({
  id,
  organizationId: `org_${id}`,
  verifiedDomains: [domain],
  domainVerifications: [proof(domain)],
});

describe("PrismaSsoDomainReproofTargets", () => {
  it("chooses unswept connections before the oldest swept connections", async () => {
    const findMany = vi
      .fn()
      .mockResolvedValueOnce([connection("connection_unswept", "new.example")])
      .mockResolvedValueOnce([
        connection("connection_oldest_a", "old-a.example"),
        connection("connection_oldest_b", "old-b.example"),
      ]);
    const prisma = {
      ssoConnection: { findMany },
      ssoConnectionReproofCursor: {
        createMany: vi.fn(),
        updateMany: vi.fn(),
      },
    };
    const repository = new PrismaSsoDomainReproofTargets(prisma);

    const targets = await repository.findDomainsProvedByRecord({ limit: 3 });

    expect(targets.map((target) => target.connectionId)).toEqual([
      "connection_unswept",
      "connection_oldest_a",
      "connection_oldest_b",
    ]);
    expect(findMany).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: expect.objectContaining({ reproofCursor: { is: null } }),
        orderBy: { id: "asc" },
        take: 3,
      }),
    );
    expect(findMany).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: expect.objectContaining({ reproofCursor: { isNot: null } }),
        orderBy: [{ reproofCursor: { lastReproofAt: "asc" } }, { id: "asc" }],
        take: 2,
      }),
    );
  });

  it("inserts missing cursors and advances existing cursors", async () => {
    const createMany = vi.fn().mockResolvedValue({ count: 1 });
    const updateMany = vi.fn().mockResolvedValue({ count: 2 });
    const prisma = {
      ssoConnection: { findMany: vi.fn() },
      ssoConnectionReproofCursor: { createMany, updateMany },
    };
    const repository = new PrismaSsoDomainReproofTargets(prisma);
    const atMs = 1_725_000_000_000;
    const lastReproofAt = new Date(atMs);

    await repository.markSwept({
      connectionIds: [
        "connection_new",
        "connection_existing",
        "connection_new",
      ],
      atMs,
    });

    expect(createMany).toHaveBeenCalledWith({
      data: [
        { connectionId: "connection_new", lastReproofAt },
        { connectionId: "connection_existing", lastReproofAt },
      ],
      skipDuplicates: true,
    });
    expect(updateMany).toHaveBeenCalledWith({
      where: {
        connectionId: { in: ["connection_new", "connection_existing"] },
        lastReproofAt: { lt: lastReproofAt },
      },
      data: { lastReproofAt },
    });
    expect(createMany.mock.invocationCallOrder[0]).toBeLessThan(
      updateMany.mock.invocationCallOrder[0]!,
    );
  });
});
