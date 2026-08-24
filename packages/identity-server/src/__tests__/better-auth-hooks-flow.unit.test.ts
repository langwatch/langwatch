/**
 * The `databaseHooks` seam against the real better-auth library (ADR-116).
 *
 * The previous version of this suite drove a storage-replacing adapter, and
 * is what proved that design impossible: better-auth satisfies its own
 * `join: { account: true }` with a second query issued *below* any wrapper,
 * so a wrapped adapter cannot intercept a model completely. ADR-116 stopped
 * intercepting. `Account` is now a projection of the event log written by
 * the fold, and better-auth reads it with the completely stock adapter.
 *
 * What this suite proves is therefore different, and stronger:
 *
 *  1. **better-auth is unimpeded.** Sign-up, sign-in, the account list and a
 *     password change all work with nothing in front of them — including the
 *     joined read that defeated the adapter.
 *  2. **The facts are stated anyway.** The hooks turn the row writes that
 *     mean something into identity commands, gated per user.
 *
 * Real `betterAuth()`, real handlers, real `IdentityCeremonies`, real
 * `IdentityService` and guards. The ledger folds in memory rather than
 * through ClickHouse and a queue, and better-auth's own `memoryAdapter`
 * stands in for Prisma — the fold's `Account` projection is app-layer, and
 * is covered by `identity-projection.prisma.repository.integration.test.ts`.
 *
 * Hermetic (no database, no network), so it stays in the unit bucket like
 * the app's `resetRecoversOauthUser.test.ts`.
 */
import type {
  IdentityCommand,
  IdentityFact,
  IdentityFactInput,
} from "@langwatch/identity";
import type { BetterAuthOptions } from "better-auth";
import { betterAuth } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";
import { beforeEach, describe, expect, it } from "vitest";
import { IdentityCeremonies } from "../better-auth/identity-ceremonies";
import { IdentityGuards } from "../guards";
import { newIdentityCommandId } from "../identity-command-id";
import type { IdentityLedger } from "../identity-ledger";
import type { IdentityUsersRepository } from "../identity-users.repository";
import { IdentityService } from "../identity.service";
import { InMemoryHeads, T0 } from "./support/in-memory-heads";
import { InMemoryReservations } from "./support/in-memory-reservations";

type MemoryDB = Record<string, Record<string, unknown>[]>;

const PASSWORD = "correct-horse-battery";

function harness() {
  const db: MemoryDB = { user: [], session: [], account: [], verification: [] };
  const heads = new InMemoryHeads();
  const commands: IdentityCommand[] = [];
  const gateOpen = { value: false };

  /** The ledger, folding straight into the heads: what the app's pipeline
   *  does once ClickHouse holds the append and the projection catches up. */
  const ledger: IdentityLedger = {
    async commit({
      command,
      facts,
    }: {
      command: IdentityCommand;
      facts: IdentityFactInput[];
    }): Promise<IdentityFact[]> {
      commands.push(command);
      heads.fold((command.data as { userId: string }).userId, facts, T0);
      return facts.map((f) => ({ ...f, occurredAt: T0 }) as IdentityFact);
    },
  };

  const users: IdentityUsersRepository = {
    async storeUserHashKeyIfMissing() {},
    async findEmail({ userId }) {
      const row = db.user?.find((candidate) => candidate.id === userId);
      return typeof row?.email === "string" ? row.email : null;
    },
    async findUserIdByEmail({ normalizedValue }) {
      const row = db.user?.find(
        (candidate) =>
          typeof candidate.email === "string" &&
          candidate.email.toLowerCase() === normalizedValue.toLowerCase(),
      );
      return typeof row?.id === "string" ? row.id : null;
    },
  };

  const identity = new IdentityService(new IdentityGuards(heads, users, new InMemoryReservations()), ledger);
  const ceremonies = new IdentityCeremonies(
    heads,
    users,
    identity,
    async () => gateOpen.value,
    { now: () => T0, newCommandId: newIdentityCommandId },
  );

  const auth = betterAuth({
    baseURL: "http://localhost:3000",
    secret: "test-secret-test-secret-test-secret",
    // ADR-116: nothing wraps this. The stock engine, exactly as the app
    // configures `prismaAdapter`.
    database: (options: BetterAuthOptions) => memoryAdapter(db)(options),
    emailAndPassword: { enabled: true },
    databaseHooks: {
      account: {
        create: {
          before: async (account) => ceremonies.beforeAccountCreate(account),
        },
        delete: {
          before: async (account) => {
            await ceremonies.beforeAccountDelete(account);
          },
        },
      },
      user: {
        delete: {
          before: async (user) => {
            await ceremonies.beforeUserDelete(user);
          },
        },
      },
    },
  });

  return { auth, db, heads, commands, gateOpen };
}

type Harness = ReturnType<typeof harness>;

async function signUp(h: Harness, email: string): Promise<string> {
  const response = await h.auth.api.signUpEmail({
    body: { email, password: PASSWORD, name: "Sam" },
    asResponse: true,
  });
  return response.headers.get("set-cookie") ?? "";
}

const statedIdentifiers = (h: Harness) =>
  [...h.heads.heads.values()].flatMap((heads) =>
    Object.values(heads.identifiers),
  );

describe("better-auth over the databaseHooks seam", () => {
  let h: Harness;

  beforeEach(() => {
    h = harness();
  });

  describe("given an organization nobody has enrolled", () => {
    /** @scenario "Signing up on an unmigrated organization writes nothing extra" */
    it("signs up and signs in with nothing stated at all", async () => {
      await signUp(h, "legacy@acme.com");

      // The gate is closed, so every hook returned having done nothing.
      // This is the migration-safety claim, checked rather than asserted:
      // an unenrolled organization behaves exactly as it did before any of
      // this existed.
      expect(h.commands).toHaveLength(0);
      expect(h.heads.heads.size).toBe(0);
      expect(h.db.account).toHaveLength(1);

      const signedIn = await h.auth.api.signInEmail({
        body: { email: "legacy@acme.com", password: PASSWORD },
      });
      expect(signedIn.user.email).toBe("legacy@acme.com");
    });
  });

  describe("given an organization that has finalized", () => {
    beforeEach(() => {
      h.gateOpen.value = true;
    });

    /**
     * The read that defeated the storage-replacing adapter, now working.
     *
     * `signInEmail` reaches `findUserByEmail(email, { includeAccounts: true
     * })`, which asks for the user with `join: { account: true }`. With
     * joins off — the default — the adapter factory satisfies that join
     * itself, through the instance it was built around. Nothing sits in
     * front of it any more, so it simply works.
     */
    /** @scenario "better-auth reads an account through its own storage" */
    it("completes the joined sign-in read that no wrapper could serve", async () => {
      await signUp(h, "member@acme.com");

      const signedIn = await h.auth.api.signInEmail({
        body: { email: "member@acme.com", password: PASSWORD },
      });

      expect(signedIn.user.email).toBe("member@acme.com");
    });

    it("lists the account, reading the row better-auth wrote itself", async () => {
      const cookie = await signUp(h, "member@acme.com");

      const accounts = await h.auth.api.listUserAccounts({
        headers: new Headers({ cookie }),
      });

      expect(accounts).toHaveLength(1);
      expect(accounts[0]).toMatchObject({ providerId: "credential" });
      expect(h.db.account).toHaveLength(1);
    });

    /** @scenario "A password change states nothing, because a secret is not a fact" */
    it("changes a password without stating anything: a secret is not a fact", async () => {
      const cookie = await signUp(h, "member@acme.com");
      const statedBySignUp = h.commands.length;

      await h.auth.api.changePassword({
        body: {
          currentPassword: PASSWORD,
          newPassword: "staple-battery-horse",
        },
        headers: new Headers({ cookie }),
      });

      // The payload rule in action: secrets are barred from the event log,
      // so rewriting one states nothing.
      expect(h.commands).toHaveLength(statedBySignUp);

      const signedIn = await h.auth.api.signInEmail({
        body: { email: "member@acme.com", password: "staple-battery-horse" },
      });
      expect(signedIn.user.email).toBe("member@acme.com");
    });

    describe("when a second sign-in method is linked", () => {
      /** @scenario "A latched user's domain-significant writes produce events structurally" */
      it("states the attach, pinning the id better-auth writes", async () => {
        await signUp(h, "member@acme.com");
        const userId = h.db.user?.[0]?.id as string;
        const before = h.commands.length;

        await (
          await h.auth.$context
        ).internalAdapter.linkAccount({
          userId,
          providerId: "google",
          accountId: "sub-google-1",
        });

        expect(
          h.commands.slice(before).map((command) => command.type),
        ).toEqual(["lw.identity.attach_identifier"]);

        const google = statedIdentifiers(h).find(
          (identifier) => identifier.provider === "google",
        );
        expect(google).toMatchObject({ providerAccountId: "sub-google-1" });
        // The id the ceremony pinned IS the row's id. That is what lets the
        // fold project onto the row better-auth wrote (ADR-116 §5) rather
        // than creating a second one beside it.
        expect(h.db.account?.map((row) => row.id)).toContain(
          google?.accountId,
        );
      });
    });

    describe("when the user is deleted", () => {
      /** @scenario "Deleting a latched user runs the erase ceremony before the row delete" */
      it("states the erase before the row goes", async () => {
        await signUp(h, "member@acme.com");
        const userId = h.db.user?.[0]?.id as string;

        await (await h.auth.$context).internalAdapter.deleteUser(userId);

        expect(h.commands.map((command) => command.type)).toContain(
          "lw.identity.erase_user",
        );
      });
    });
  });
});
