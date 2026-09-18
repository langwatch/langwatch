/**
 * @vitest-environment node
 *
 * The identity storage adapter's transaction, against the real Postgres it
 * promises (see specs/identity/identity-storage-adapter.feature, "Transactions").
 *
 * The adapter under test is the one the application composes — imported from
 * the composition root rather than rebuilt here — so what these assertions
 * hold is the wiring better-auth actually gets, not a second arrangement that
 * happens to agree with it.
 *
 * `SsoProvider` is the table throughout, and deliberately: it is the row
 * `@better-auth/sso` locks for the length of an account link, by issuing a
 * no-op update against it and then checking the provider's identity boundary
 * has not moved. The lock is the reason the adapter declares a transaction at
 * all, so the suite proves the lock rather than settling for the declaration.
 */
import { sso } from "@better-auth/sso";
import { betterAuth } from "better-auth";
import { nanoid } from "nanoid";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { models } from "~/server/better-auth/config/models";
import { prisma } from "~/server/db";
import { identityStorageAdapter } from "../runtime";

/** Every row this file writes, so the table is left as it was found. */
const written: string[] = [];

const providerId = (): string => {
  const id = `sso-transaction-test-${nanoid(10)}`;
  written.push(id);
  return id;
};

const provider = (id: string) => ({
  issuer: `https://idp.${id}.test`,
  providerId: id,
  domain: `${id}.test`,
});

/** The adapter this suite drives, and the one handed to a transaction's
 *  callback — the second is the first without `transaction` on it. */
type UnderTest = Awaited<ReturnType<typeof buildAuth>["$context"]>["adapter"];

/**
 * The plugin's row lock, verbatim (`lockSSOProviderRow` in
 * @better-auth/sso): an update that changes nothing, issued for the tuple
 * lock it takes rather than for the write. The shape is copied rather than
 * imported because the plugin does not export it.
 */
const lock = (
  adapter: Pick<UnderTest, "update">,
  row: { id: string; providerId: string },
) =>
  adapter.update({
    model: "ssoProvider",
    where: [
      { field: "id", value: row.id },
      { field: "providerId", value: row.providerId },
    ],
    update: { providerId: row.providerId },
  });

const deferred = (): { promise: Promise<void>; resolve: () => void } => {
  let resolve!: () => void;
  const promise = new Promise<void>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
};

const buildAuth = () =>
  betterAuth({
    baseURL: "http://localhost:3000",
    secret: "test-secret-test-secret-test-secret",
    database: identityStorageAdapter(),
    // The `ssoProvider` table is the plugin's, so the plugin has to be
    // mounted for the adapter to know the model at all.
    plugins: [sso()],
    ...models(),
  });

let adapter: UnderTest;

beforeAll(async () => {
  adapter = (await buildAuth().$context).adapter;
});

afterEach(async () => {
  if (written.length > 0) {
    await prisma.ssoProvider.deleteMany({
      where: { providerId: { in: written.splice(0, written.length) } },
    });
  }
});

describe("given a transaction against the identity storage adapter", () => {
  describe("when two Postgres-backed writes are made inside it and the callback returns", () => {
    /** @scenario "Work inside a transaction commits together" */
    it("leaves both writes visible afterwards", async () => {
      const first = providerId();
      const second = providerId();

      await adapter.transaction(async (transactional) => {
        await transactional.create({
          model: "ssoProvider",
          data: provider(first),
        });
        await transactional.create({
          model: "ssoProvider",
          data: provider(second),
        });
      });

      expect(
        (
          await prisma.ssoProvider.findMany({
            where: { providerId: { in: [first, second] } },
            select: { providerId: true },
          })
        )
          .map((row) => row.providerId)
          .sort(),
      ).toEqual([first, second].sort());
    });
  });

  describe("when a Postgres-backed write is made inside it and the callback then throws", () => {
    /** @scenario "Work inside a transaction rolls back together" */
    it("leaves that write invisible and hands the caller its own error", async () => {
      const abandoned = providerId();
      const failure = new Error("the ceremony failed after the write");

      await expect(
        adapter.transaction(async (transactional) => {
          await transactional.create({
            model: "ssoProvider",
            data: provider(abandoned),
          });
          // Visible to the transaction that wrote it, so what the assertion
          // below reads is a rollback rather than a write that never landed.
          expect(
            await transactional.findOne({
              model: "ssoProvider",
              where: [{ field: "providerId", value: abandoned }],
            }),
          ).not.toBeNull();
          throw failure;
        }),
      ).rejects.toBe(failure);

      expect(
        await prisma.ssoProvider.findFirst({
          where: { providerId: abandoned },
          select: { providerId: true },
        }),
      ).toBeNull();
    });
  });
});

describe("given a single sign-on connection whose provider row is locked inside a transaction", () => {
  describe("when a second link for the same provider tries to lock that row", () => {
    /** @scenario "A provider row locked for a link holds until the link finishes" */
    it("makes the second wait until the first transaction finishes", async () => {
      const id = providerId();
      const row = await prisma.ssoProvider.create({
        data: { id: `ssoprov_${nanoid(12)}`, ...provider(id) },
        select: { id: true, providerId: true },
      });

      const locked = deferred();
      const release = deferred();
      const order: string[] = [];

      const firstLink = adapter.transaction(async (transactional) => {
        await lock(transactional, row);
        locked.resolve();
        await release.promise;
        order.push("first-link-finished");
      });

      await locked.promise;

      const secondLink = adapter.transaction(async (transactional) => {
        await lock(transactional, row);
        order.push("second-link-locked");
      });

      // Long enough that a second link which was NOT waiting would have
      // taken the lock and pushed its entry by now. It has not, because the
      // row lock the first transaction holds is a real one.
      await new Promise((settle) => setTimeout(settle, 500));
      expect(order).toEqual([]);

      release.resolve();
      await Promise.all([firstLink, secondLink]);

      expect(order).toEqual(["first-link-finished", "second-link-locked"]);
    });
  });
});
