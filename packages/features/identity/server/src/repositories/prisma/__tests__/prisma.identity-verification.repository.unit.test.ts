import { describe, expect, it } from "vitest";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { PrismaIdentityVerificationRepository } from "../prisma.identity-verification.repository";

/**
 * `consume` reaps every generation it reads, not just the pair it was
 * offered (D01) — `identifier` carries no unique constraint on the legacy
 * `VerificationToken` table, so two mints racing each other both insert
 * rather than one replacing the other. Single-use enforcement lives in that
 * reap, and this pins it directly: the older record must never complete,
 * before OR after the newer one does.
 */

interface Row {
  identifier: string;
  token: string;
  expires: Date;
  createdAt: Date;
}

function makeFakePrisma() {
  const rows: Row[] = [];
  let seq = 0;

  const store = {
    async deleteMany(args: { where: { identifier: string; token?: { in: string[] } } }) {
      const before = rows.length;
      const matches = (row: Row) =>
        row.identifier === args.where.identifier &&
        (!args.where.token || args.where.token.in.includes(row.token));
      for (let i = rows.length - 1; i >= 0; i--) {
        if (matches(rows[i]!)) rows.splice(i, 1);
      }
      return { count: before - rows.length };
    },
    async create(args: { data: { identifier: string; token: string; expires: Date } }) {
      seq += 1;
      rows.push({ ...args.data, createdAt: new Date(seq) });
    },
    async findMany(args: { where: { identifier: string } }) {
      return rows
        .filter((row) => row.identifier === args.where.identifier)
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    },
    async findFirst(args: { where: { identifier: string } }) {
      return (await store.findMany(args))[0] ?? null;
    },
  };

  const prisma = {
    verificationToken: store,
    async $transaction(arg: unknown) {
      if (typeof arg === "function") return (arg as (tx: unknown) => unknown)(prisma);
      return Promise.all(arg as Promise<unknown>[]);
    },
  };
  return prisma as unknown as PrismaClient;
}

describe("PrismaIdentityVerificationRepository", () => {
  describe("given two verification mints for one identifier raced and both records landed", () => {
    describe("when the newer link is completed", () => {
      /** @scenario "A superseded verification link can never complete" */
      it("reaps the older record with it, and neither the old nor a pre-completion attempt succeeds again", async () => {
        const prisma = makeFakePrisma();
        const repository = new PrismaIdentityVerificationRepository(prisma);

        await repository.replaceForIdentifier({
          verificationId: "verif_old",
          userId: "user_1",
          identifierId: "idf_1",
          tokenHash: "hash-old",
          codeChallenge: "challenge-old",
          expiresAtMs: Date.now() + 60_000,
        });
        // The race: this mint does not delete the older row because a
        // concurrent replace already read past it — both land as separate
        // generations under the same identifier.
        await prisma.verificationToken.create({
          data: {
            identifier: "identity-verify:idf_1",
            token: JSON.stringify({
              v: 1,
              verificationId: "verif_new",
              userId: "user_1",
              identifierId: "idf_1",
              tokenHash: "hash-new",
              codeChallenge: "challenge-new",
            }),
            expires: new Date(Date.now() + 60_000),
          },
        });

        // The older link could not have completed even before the newer one
        // did — it was never the current generation.
        expect(
          await repository.consume({ identifierId: "idf_1", verificationId: "verif_old" }),
        ).toBe(false);

        expect(
          await repository.consume({ identifierId: "idf_1", verificationId: "verif_new" }),
        ).toBe(true);

        // And the older link cannot complete afterwards either — its
        // generation was reaped along with the newer one's consumption.
        expect(
          await repository.consume({ identifierId: "idf_1", verificationId: "verif_old" }),
        ).toBe(false);
        expect(await repository.tryFindByIdentifierId({ identifierId: "idf_1" })).toBeNull();
      });
    });
  });
});
