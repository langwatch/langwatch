/**
 * The statements behind a virtual key — the gateway's credential.
 *
 * Two properties carry the weight here and neither is visible from the service
 * above. First, which reads are scoped to an organization and which are
 * deliberately not: `tryFindByIdGlobal` and `tryFindByHashedSecret` answer
 * across every tenant on purpose, because a request arrives bearing a secret
 * and nothing else. Second, the rotation grace window — a rotated key keeps
 * working for a bounded period, and "bounded" is a single `gt` predicate.
 *
 * A recording fake stands in for Prisma: the claim is about the statement
 * issued, not about what a database does with it.
 */

import { describe, expect, it } from "vitest";
import { PrismaGatewayVirtualKeyRepository } from "../prisma.virtual-key.repository";

type Call = { method: string; args: Record<string, unknown> };

function repositoryWith(row: unknown = { id: "key-1", scopes: [] }) {
  const calls: Call[] = [];
  const record = (method: string) => async (args: Record<string, unknown>) => {
    calls.push({ method, args });
    return row;
  };
  const prisma = {
    virtualKey: {
      findFirst: record("findFirst"),
      findUnique: record("findUnique"),
      update: record("update"),
    },
  };

  return { calls, repository: new PrismaGatewayVirtualKeyRepository(prisma as never) };
}

describe("PrismaGatewayVirtualKeyRepository", () => {
  describe("given a key looked up by id", () => {
    describe("when the organization is known", () => {
      it("scopes the read to it, so another tenant's key cannot be read", async () => {
        const { repository, calls } = repositoryWith();

        await repository.tryFindById("key-1", "organization-1");

        expect(calls[0]?.args.where).toEqual({ id: "key-1", organizationId: "organization-1" });
      });
    });

    describe("when the caller asks globally", () => {
      it("reads on id alone, which is what the name promises", async () => {
        const { repository, calls } = repositoryWith();

        await repository.tryFindByIdGlobal("key-1");

        expect(calls[0]?.args.where).toEqual({ id: "key-1" });
      });
    });
  });

  describe("given a request bearing a secret", () => {
    describe("when the key is resolved from it", () => {
      it("accepts the current secret", async () => {
        const { repository, calls } = repositoryWith();

        await repository.tryFindByHashedSecret("hash-current");

        const or = (calls[0]?.args.where as { OR: Array<Record<string, unknown>> }).OR;
        expect(or[0]).toEqual({ hashedSecret: "hash-current" });
      });

      it("also accepts the previous secret, but only while its window is open", async () => {
        const { repository, calls } = repositoryWith();

        await repository.tryFindByHashedSecret("hash-previous");

        const or = (calls[0]?.args.where as { OR: Array<Record<string, unknown>> }).OR;
        const previous = or[1] as {
          previousHashedSecret: string;
          previousSecretValidUntil: { gt: Date };
        };
        expect(previous.previousHashedSecret).toBe("hash-previous");
        // `gt`, not `gte` or absent: once the window closes the old secret is
        // dead, and without this predicate a rotated secret would work forever.
        expect(Object.keys(previous.previousSecretValidUntil)).toEqual(["gt"]);
        expect(previous.previousSecretValidUntil.gt).toBeInstanceOf(Date);
      });
    });
  });

  describe("given a key being rotated", () => {
    describe("when the new secret is written", () => {
      it("keeps the old one alongside it with the window it was given", async () => {
        const { repository, calls } = repositoryWith();
        const validUntil = new Date("2026-09-01T00:00:00.000Z");

        await repository.rotateSecret(
          "key-1",
          "organization-1",
          "hash-new",
          "lw_new",
          "hash-old",
          validUntil,
        );

        expect(calls[0]?.args.where).toEqual({ id: "key-1", organizationId: "organization-1" });
        expect(calls[0]?.args.data).toMatchObject({
          hashedSecret: "hash-new",
          displayPrefix: "lw_new",
          previousHashedSecret: "hash-old",
          previousSecretValidUntil: validUntil,
        });
      });

      it("advances the revision, so a cached decision can tell it changed", async () => {
        const { repository, calls } = repositoryWith();

        await repository.rotateSecret(
          "key-1",
          "organization-1",
          "hash-new",
          "lw_new",
          "hash-old",
          new Date(),
        );

        expect((calls[0]?.args.data as { revision: unknown }).revision).toEqual({
          increment: 1n,
        });
      });
    });
  });

  describe("given a key being revoked", () => {
    describe("when the revocation is written", () => {
      it("scopes it to the organization", async () => {
        const { repository, calls } = repositoryWith();

        await repository.revoke("key-1", "organization-1", "user-1");

        expect(calls[0]?.args.where).toEqual({ id: "key-1", organizationId: "organization-1" });
      });

      it("stamps when it happened", async () => {
        const { repository, calls } = repositoryWith();

        await repository.revoke("key-1", "organization-1", "user-1");

        expect((calls[0]?.args.data as { revokedAt: unknown }).revokedAt).toBeInstanceOf(Date);
      });
    });
  });
});
