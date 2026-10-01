import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { prismaDouble } from "@langwatch/test-harness/client-doubles/prisma";
import { describe, expect, it } from "vitest";

import { PrismaIdentityVerificationRepository } from "../prisma.identity-verification.repository.ts";

/**
 * `consume` reaps every generation it reads, not just the pair it was offered (D01) — `identifier`
 * carries no unique constraint on the legacy `VerificationToken` table, so two mints racing each
 * other both insert rather than one replacing the other.
 */

interface Row {
  identifier: string;
  token: string;
  expires: Date;
  createdAt: Date;
}

function field(value: unknown, key: string): unknown {
  return typeof value === "object" && value !== null ? Reflect.get(value, key) : undefined;
}

function makeFakePrisma() {
  const rows: Row[] = [];
  let seq = 0;
  const newestFirst = (args: unknown) =>
    rows
      .filter((row) => row.identifier === field(field(args, "where"), "identifier"))
      .toSorted((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

  const store = {
    async deleteMany(args: unknown) {
      const where = field(args, "where");
      const tokens = field(field(where, "token"), "in");
      const before = rows.length;
      const matches = (row: Row) =>
        row.identifier === field(where, "identifier") &&
        (!Array.isArray(tokens) || tokens.includes(row.token));
      for (let i = rows.length - 1; i >= 0; i--) {
        if (matches(rows[i]!)) rows.splice(i, 1);
      }
      return { count: before - rows.length };
    },
    async create(args: unknown) {
      const data = field(args, "data");
      const [identifier, token, expires] = ["identifier", "token", "expires"].map((key) =>
        field(data, key),
      );
      if (typeof identifier !== "string" || typeof token !== "string") throw new Error("bad row");
      if (!(expires instanceof Date)) throw new Error("bad expiry");
      seq += 1;
      rows.push({ identifier, token, expires, createdAt: new Date(seq) });
    },
    findMany: async (args: unknown) => newestFirst(args),
    findFirst: async (args: unknown) => newestFirst(args)[0] ?? null,
  };

  const prisma: PrismaClient = prismaDouble({
    verificationToken: store,
    $transaction: async (arg: unknown) => {
      if (typeof arg === "function") return arg(prisma);
      return Array.isArray(arg) ? Promise.all(arg) : arg;
    },
  });
  return prisma;
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
        await expect(repository.getByIdentifierId({ identifierId: "idf_1" })).rejects.toMatchObject(
          {
            code: "identity_verification_invalid",
          },
        );
      });
    });
  });
});
