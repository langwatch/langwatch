/** @vitest-environment node */
import { nanoid } from "nanoid";
import { afterAll, describe, expect, it } from "vitest";
import { Prisma, type PrismaClient } from "~/generated/prisma/client";
import { prisma } from "~/server/db";
import { cleanupTestRows } from "~/test-utils/cleanupTestRows";
import { PrismaCredentialAccountRepository } from "../credential-account.prisma.repository";

/**
 * The "last way in" rule, against the store that actually decides it.
 *
 * `credential-account.service.unit.test.ts` exercises the rule over a fake
 * whose `deleteLinkedAccount` refuses when the person is down to one row — so
 * the fake IS the rule, and it would keep passing with the real transaction
 * deleted. What the real decision rests on is the SERIALIZABLE transaction in
 * `credential-account.prisma.repository.ts`, whose own comment records the
 * shipped bug it fixes: the count, the read and the delete used to be three
 * unisolated statements, so a double-clicked cross could have two unlinks both
 * observe two accounts, both pass the guard and both delete — leaving somebody
 * with no way to sign in at all.
 *
 * That is a property of PostgreSQL's isolation level, so nothing short of a
 * real database can observe it, and dropping the transaction back to the
 * default isolation is exactly the regression this file exists to catch.
 */

const namespace = `credential-account-${nanoid(8)}`;

/** Both transactions have fixed their snapshot; neither may commit before the other has. */
function twoPartyBarrier(): () => Promise<void> {
  let arrivals = 0;
  let release: (() => void) | null = null;
  const bothArrived = new Promise<void>((resolve) => {
    release = resolve;
  });
  return async () => {
    arrivals += 1;
    if (arrivals === 2) {
      if (release === null) {
        throw new Error("barrier was not initialized");
      }
      release();
    }
    await bothArrived;
  };
}

/**
 * The same barrier the passkey-removal sibling injects through its
 * `routesToIdentity` seam, injected here through the client instead.
 *
 * This repository takes only a `PrismaClient`, so there is no collaborator to
 * hang the barrier on. Wrapping the client puts it in the one place that makes
 * the race deterministic rather than a matter of scheduling luck: immediately
 * after the `account.count` that fixes each transaction's snapshot, and before
 * either delete. Without it the two transactions can serialize by accident and
 * the test would report a pass it did not earn.
 */
function withBarrierAfterAccountCount(
  client: PrismaClient,
  barrier: () => Promise<void>,
): PrismaClient {
  const bound = (target: object, property: string | symbol): unknown => {
    const value = Reflect.get(target, property) as unknown;
    return typeof value === "function"
      ? (value as (...args: unknown[]) => unknown).bind(target)
      : value;
  };

  const barrieredTx = (
    tx: Prisma.TransactionClient,
  ): Prisma.TransactionClient =>
    new Proxy(tx, {
      get(target, property) {
        if (property !== "account") return bound(target, property);
        return new Proxy(target.account, {
          get(accountTarget, accountProperty) {
            if (accountProperty !== "count") {
              return bound(accountTarget, accountProperty);
            }
            return async (...args: unknown[]) => {
              const counted = await (
                accountTarget.count as (...a: unknown[]) => Promise<number>
              )(...args);
              await barrier();
              return counted;
            };
          },
        });
      },
    }) as Prisma.TransactionClient;

  return new Proxy(client, {
    get(target, property) {
      if (property !== "$transaction") return bound(target, property);
      return (
        callback: (tx: Prisma.TransactionClient) => Promise<unknown>,
        options?: unknown,
      ) =>
        (
          target.$transaction as (
            fn: (tx: Prisma.TransactionClient) => Promise<unknown>,
            options?: unknown,
          ) => Promise<unknown>
        )(async (tx) => await callback(barrieredTx(tx)), options);
    },
  }) as PrismaClient;
}

async function seedUser({
  suffix,
  providers,
}: {
  suffix: string;
  providers: string[];
}): Promise<{ userId: string; accountIds: string[] }> {
  const userId = `${namespace}-${suffix}`;
  await prisma.user.create({
    data: {
      id: userId,
      email: `${userId}@example.com`,
      name: suffix,
      emailVerified: true,
    },
  });
  const accountIds = providers.map(
    (provider) => `${userId}-account-${provider}`,
  );
  await prisma.account.createMany({
    data: providers.map((provider, index) => ({
      id: accountIds[index]!,
      userId,
      provider,
      issuer: `local:${provider}`,
      providerAccountId: `${userId}-${provider}`,
      password: provider === "credential" ? "a-hash" : null,
    })),
  });
  return { userId, accountIds };
}

afterAll(async () => {
  await cleanupTestRows(prisma, [
    ["account", { userId: { startsWith: namespace } }],
    ["user", { id: { startsWith: namespace } }],
  ]);
});

describe("PrismaCredentialAccountRepository.deleteLinkedAccount", () => {
  describe("given two sign-in methods and two unlinks arriving together", () => {
    describe("when both transactions read the same two-account state", () => {
      it("never lets both deletes land, so a way in always survives", async () => {
        const { userId, accountIds } = await seedUser({
          suffix: "concurrent",
          providers: ["credential", "google"],
        });
        const first = accountIds[0];
        const second = accountIds[1];
        if (first === undefined || second === undefined) {
          throw new Error("the concurrency fixture did not create two accounts");
        }

        const repository = new PrismaCredentialAccountRepository(
          withBarrierAfterAccountCount(prisma, twoPartyBarrier()),
        );

        const settled = await Promise.allSettled([
          repository.deleteLinkedAccount({ userId, accountId: first }),
          repository.deleteLinkedAccount({ userId, accountId: second }),
        ]);

        const outcomes = settled.flatMap((attempt) =>
          attempt.status === "fulfilled" ? [attempt.value] : [],
        );
        const rejections = settled.flatMap((attempt) =>
          attempt.status === "rejected" ? [attempt.reason as unknown] : [],
        );

        // THE ASSERTION THE SHIPPED BUG WOULD FAIL. At the default isolation
        // both transactions count two, both find their own row and both
        // delete, and the person is left with nothing to sign in with.
        expect(
          outcomes.filter((outcome) => outcome === "deleted"),
        ).toHaveLength(1);
        expect(await prisma.account.count({ where: { userId } })).toBe(1);

        // HOW the loser loses, which is the half a person actually sees.
        // Serializable answers a lost race by refusing to commit it, so
        // without a retry the loser surfaced as a raw write conflict — safe,
        // because nothing was deleted twice, but indistinguishable to the
        // caller from the database falling over. `withSerializationRetry`
        // re-runs it, the second attempt reads the state the winner left,
        // and the guard answers the refusal it had already computed.
        //
        // Pinned rather than tolerated: accepting either shape here would let
        // the retry be dropped again without a test noticing, and the raw
        // exception is exactly what this file was written to catch.
        expect(rejections).toEqual([]);
        expect([...outcomes].sort()).toEqual(["deleted", "would_strand_user"]);
      });
    });
  });

  describe("given somebody down to a single sign-in method", () => {
    describe("when it is unlinked", () => {
      it("refuses inside the transaction and deletes nothing", async () => {
        const { userId, accountIds } = await seedUser({
          suffix: `only-${nanoid(5)}`,
          providers: ["credential"],
        });
        const repository = new PrismaCredentialAccountRepository(prisma);

        await expect(
          repository.deleteLinkedAccount({
            userId,
            accountId: accountIds[0]!,
          }),
        ).resolves.toBe("would_strand_user");
        expect(await prisma.account.count({ where: { userId } })).toBe(1);
      });
    });
  });

  describe("given an account id that is not this person's", () => {
    describe("when it is unlinked", () => {
      it("says so rather than deleting somebody else's row", async () => {
        const { userId } = await seedUser({
          suffix: `stranger-${nanoid(5)}`,
          providers: ["credential", "google"],
        });
        const other = await seedUser({
          suffix: `other-${nanoid(5)}`,
          providers: ["credential", "github"],
        });
        const repository = new PrismaCredentialAccountRepository(prisma);

        await expect(
          repository.deleteLinkedAccount({
            userId,
            accountId: other.accountIds[1]!,
          }),
        ).resolves.toBe("no_such_account");
        expect(
          await prisma.account.count({ where: { userId: other.userId } }),
        ).toBe(2);
      });
    });
  });
});
