/**
 * `AccountCredential.userId` cascades under `relationMode = "prisma"` (packages/prisma-
 * client/prisma/schema.prisma),
 * Spec: specs/identity/identity-storage-adapter.feature.
 */
import { nanoid } from "nanoid";
import { afterAll, describe, expect, it } from "vitest";
import {
  PrismaConfigService,
  PrismaConnectionService,
  PrismaTenancyGuardService,
} from "@langwatch/prisma-client";
import type { PrismaClient } from "@langwatch/prisma-client/generated";

const DB_URL = process.env.LANGWATCH_TEST_DATABASE_URL;

describe.skipIf(!DB_URL)("AccountCredential cascade on User delete", () => {
  const testNamespace = `acc-cred-cascade-${nanoid(8)}`;
  let userId: string;

  const connection = PrismaConnectionService.create({
    guard: PrismaTenancyGuardService.create(),
  }).connect(PrismaConfigService.create().resolve({ databaseUrl: DB_URL ?? "", log: ["error"] }));
  const prisma = connection.client as PrismaClient;

  afterAll(async () => {
    if (!prisma) return;
    await prisma.accountCredential.deleteMany({ where: { userId } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  });

  describe("given an unlatched user whose Account secrets were carried into AccountCredential", () => {
    describe("when their User row is deleted", () => {
      /** @scenario "Deleting a user reaps the credentials of an unlatched one too" */
      it("takes their AccountCredential rows with them", async () => {
        const user = await prisma!.user.create({
          data: { name: "Unlatched User", email: `unlatched-${testNamespace}@example.com` },
        });
        userId = user.id;
        await prisma!.accountCredential.create({
          data: {
            id: `${testNamespace}-acc`,
            userId,
            provider: "credential",
            password: "hashed-password",
          },
        });

        await prisma!.user.delete({ where: { id: userId } });

        const remaining = await prisma!.accountCredential.findMany({ where: { userId } });
        expect(remaining).toEqual([]);
      });
    });
  });
});
