/**
 * Spec: specs/identity/sso-domain-verification.feature
 */
import { describe, expect, it, vi } from "vitest";

import {
  type PrismaSsoDomainReproofDatabase,
  PrismaSsoDomainReproofTargetRepository,
} from "../prisma.sso-domain-reproof.repository.ts";

const T0 = 1_725_000_000_000;

const proof = (domain: string) => ({
  domain,
  method: "dns-txt",
  actorId: "user_admin",
  verifiedAtMs: T0,
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

/**
 * A stand-in over the two models the rotation touches, built to their real
 * signatures: the pages it answers with are what the ordering is asserted
 * against, and a second client answering would leave them untouched.
 */
function recordingDatabase(pages: ReturnType<typeof connection>[][]) {
  const remaining = [...pages];
  const findMany = vi.fn(async (_args: unknown) => remaining.shift() ?? []);
  const createMany = vi.fn(async () => ({ count: 0 }));
  const updateMany = vi.fn(async () => ({ count: 0 }));
  const database: PrismaSsoDomainReproofDatabase = {
    ssoConnection: { findMany },
    ssoConnectionReproofCursor: { createMany, updateMany },
  };

  return { database, findMany, createMany, updateMany };
}

describe("PrismaSsoDomainReproofTargetRepository", () => {
  describe("given proved connections, some of them never looked at", () => {
    /** @scenario "Every proved domain is re-read in turn rather than the same few for ever" */
    it("takes the never-looked-at connections before the longest-unlooked-at ones", async () => {
      const { database, findMany } = recordingDatabase([
        [connection("connection_unswept", "new.example")],
        [
          connection("connection_oldest_a", "old-a.example"),
          connection("connection_oldest_b", "old-b.example"),
        ],
      ]);
      const repository = PrismaSsoDomainReproofTargetRepository.create(database);

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
    it("only re-reads a domain a published proof proved and whose hash the row carries", async () => {
      const attested = connection("connection_attested", "attested.example");
      attested.domainVerifications = [
        { ...proof("attested.example"), method: "operator-attested" },
      ];
      const unproved = connection("connection_unproved", "proved.example");
      unproved.verifiedDomains = ["other.example"];
      const { database } = recordingDatabase([
        [attested, unproved, connection("connection_published", "published.example")],
        [],
      ]);
      const repository = PrismaSsoDomainReproofTargetRepository.create(database);

      const targets = await repository.findDomainsProvedByRecord({ limit: 10 });

      expect(targets).toEqual([
        {
          connectionId: "connection_published",
          organizationId: "org_connection_published",
          domain: "published.example",
          tokenHash: "sha256:published.example",
          method: "dns-txt",
        },
      ]);
    });
  });

  describe("given a sweep that has just looked at three connections", () => {
    /** @scenario "Every proved domain is re-read in turn rather than the same few for ever" */
    it("inserts the missing cursors and then advances the ones that are behind", async () => {
      const { database, createMany, updateMany } = recordingDatabase([]);
      const repository = PrismaSsoDomainReproofTargetRepository.create(database);
      const lastReproofAt = new Date(T0);

      await repository.markSwept({
        connectionIds: ["connection_new", "connection_existing", "connection_new"],
        atMs: T0,
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
        updateMany.mock.invocationCallOrder[0] ?? 0,
      );
    });
  });

  describe("given the connection that just started wavering", () => {
    /**
     * REGRESSION. Ordering by what a re-read WRITES read the same prefix for
     * ever, and sorted the one domain in its grace window out of the batch:
     * it never lapsed, and went on vouching for new people.
     */
    /** @scenario "A domain that has started wavering is still re-read, and still lapses" */
    it("orders the rotation by when each connection was last looked at, never by when it changed", async () => {
      const { database, findMany } = recordingDatabase([
        [],
        [connection("connection_wavering", "acme.com")],
      ]);
      const repository = PrismaSsoDomainReproofTargetRepository.create(database);

      const targets = await repository.findDomainsProvedByRecord({ limit: 2 });

      expect(targets.map((target) => target.connectionId)).toEqual(["connection_wavering"]);
      const sweptQuery = findMany.mock.calls[1]?.[0];
      expect(JSON.stringify(sweptQuery)).not.toContain("updatedAt");
    });
  });
});
