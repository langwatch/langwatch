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
  /** @scenario "Every proved domain is re-read in turn rather than the same few for ever" */
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

  /** @scenario "Every proved domain is re-read in turn rather than the same few for ever" */
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

  /**
   * REGRESSION. The rotation is ordered by THE LOOK, never by the write.
   *
   * A healthy re-read emits no facts, so `updatedAt` does not move — order by
   * it and the same prefix is read every cycle, for ever. Worse, the one
   * connection that DOES move it is the one that just started wavering, which
   * sorted itself to the far end of the queue and was never re-read again:
   * its grace ran out unobserved and it went on vouching for new people. The
   * separate cursor exists so that looking is its own fact.
   */
  /** @scenario "A domain that has started wavering is still re-read, and still lapses" */
  it("orders the rotation by when each connection was last looked at, never by when it last changed", async () => {
    const findMany = vi
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([connection("connection_wavering", "acme.com")]);
    const prisma = {
      ssoConnection: { findMany },
      ssoConnectionReproofCursor: {
        createMany: vi.fn(),
        updateMany: vi.fn(),
      },
    };
    const repository = new PrismaSsoDomainReproofTargets(prisma);

    const targets = await repository.findDomainsProvedByRecord({ limit: 2 });

    // The connection that just wavered is still reachable, because nothing in
    // the ordering reacts to it having written.
    expect(targets.map((target) => target.connectionId)).toEqual([
      "connection_wavering",
    ]);
    const sweptQuery = findMany.mock.calls[1]?.[0];
    expect(sweptQuery.orderBy).toEqual([
      { reproofCursor: { lastReproofAt: "asc" } },
      { id: "asc" },
    ]);
    expect(JSON.stringify(sweptQuery.orderBy)).not.toContain("updatedAt");
  });
});
