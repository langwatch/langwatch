/**
 * ADR-116 end to end, against the real better-auth library.
 *
 * Every other suite here drives the adapter directly, which proves it answers
 * the queries we BELIEVE better-auth issues. This one lets better-auth issue
 * them: real `betterAuth()`, real sign-up / sign-in / account-list / password
 * handlers, the real `IdentityCeremonies` on `databaseHooks`, the real
 * `IdentityService` and guards. Only the two edges are faked — the ledger
 * folds in memory instead of through ClickHouse and a queue, and the base
 * engine is better-auth's own `memoryAdapter` standing in for Prisma.
 *
 * Hermetic on purpose (no database, no network), so it stays in the unit
 * bucket like the app's `resetRecoversOauthUser.test.ts` rather than paying
 * for the integration lane's datastores.
 *
 * Two things it exists to catch, both of which it found the first time it
 * ran:
 *
 *  1. better-auth calling an account query shape the adapter does not
 *     enumerate. That is otherwise invisible until a real person cannot sign
 *     in, because `findOne` answering null reads exactly like "no such
 *     account".
 *  2. better-auth reaching storage by a route the adapter does not cover.
 *     Sign-up runs inside `adapter.transaction`, and for that whole request
 *     `transaction` is the ONLY method better-auth calls on the adapter —
 *     so an adapter that passes the callback straight through is bypassed
 *     entirely, silently, on the one flow that creates accounts.
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
import type {
  AccountCredentialPatch,
  AccountCredentialRow,
  AccountCredentialsRepository,
} from "../account-credentials.repository";
import { IdentityAccountStore } from "../better-auth/account-store";
import { IdentityAccountAdapter } from "../better-auth/identity-account-adapter";
import { IdentityCeremonies } from "../better-auth/identity-ceremonies";
import { IdentityGuards } from "../guards";
import { newIdentityCommandId } from "../identity-command-id";
import type { IdentityLedger } from "../identity-ledger";
import type { IdentityUsersRepository } from "../identity-users.repository";
import { IdentityService } from "../identity.service";
import { fact, InMemoryHeads, T0 } from "./support/in-memory-heads";

type MemoryDB = Record<string, Record<string, unknown>[]>;

const PASSWORD = "correct-horse-battery";

/** The credential table in memory, with the port's patch semantics. */
class InMemoryCredentials implements AccountCredentialsRepository {
  rows = new Map<string, AccountCredentialRow>();

  async findById({ id }: { id: string }) {
    return this.rows.get(id) ?? null;
  }

  async findByIdentifierIds({ identifierIds }: { identifierIds: string[] }) {
    if (identifierIds.length === 0) return [];
    return [...this.rows.values()].filter((row) =>
      identifierIds.includes(row.identifierId),
    );
  }

  async create(row: Omit<AccountCredentialRow, "createdAtMs" | "updatedAtMs">) {
    if (this.rows.has(row.id)) return;
    this.rows.set(row.id, { ...row, createdAtMs: T0, updatedAtMs: T0 });
  }

  async update({ id, patch }: { id: string; patch: AccountCredentialPatch }) {
    await this.updateMany({ ids: [id], patch });
  }

  async updateMany({
    ids,
    patch,
  }: {
    ids: string[];
    patch: AccountCredentialPatch;
  }) {
    let touched = 0;
    for (const id of ids) {
      const row = this.rows.get(id);
      if (!row) continue;
      this.rows.set(id, { ...row, ...patch, updatedAtMs: T0 + 1 });
      touched += 1;
    }
    return touched;
  }

  async deleteByIds({ ids }: { ids: string[] }) {
    let removed = 0;
    for (const id of ids) if (this.rows.delete(id)) removed += 1;
    return removed;
  }
}

function harness() {
  const db: MemoryDB = { user: [], session: [], account: [], verification: [] };
  const heads = new InMemoryHeads();
  const credentials = new InMemoryCredentials();
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
  };

  const identity = new IdentityService(new IdentityGuards(heads), ledger);
  const gate = async () => gateOpen.value;
  const ceremonies = new IdentityCeremonies(heads, users, identity, gate, {
    now: () => T0,
    newCommandId: newIdentityCommandId,
  });
  const store = new IdentityAccountStore(heads, credentials, gate);

  const auth = betterAuth({
    baseURL: "http://localhost:3000",
    secret: "test-secret-test-secret-test-secret",
    database: (options: BetterAuthOptions) =>
      new IdentityAccountAdapter(memoryAdapter(db)(options), store),
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

  return { auth, db, heads, credentials, commands, gateOpen };
}

type Harness = ReturnType<typeof harness>;

async function signUp(h: Harness, email: string): Promise<string> {
  const response = await h.auth.api.signUpEmail({
    body: { email, password: PASSWORD, name: "Sam" },
    asResponse: true,
  });
  return response.headers.get("set-cookie") ?? "";
}

/**
 * A user as the BACKFILL leaves them: a `User` row, an identifier in the
 * projection, its secrets in the credential table, and no legacy `Account`
 * row in better-auth's own storage.
 */
async function backfilledUser(
  h: Harness,
  { userId, email }: { userId: string; email: string },
) {
  const context = await h.auth.$context;
  h.db.user?.push({
    id: userId,
    email,
    name: "Sam",
    emailVerified: true,
    createdAt: new Date(T0),
    updatedAt: new Date(T0),
  });
  h.heads.heads.set(userId, {
    userId,
    identifiers: {
      idf_credential: fact({
        identifierId: "idf_credential",
        userId,
        provider: "credential",
        value: email,
        accountId: "acc_credential",
        providerAccountId: userId,
        state: "VERIFIED",
      }),
    },
  });
  await h.credentials.create({
    id: "acc_credential",
    identifierId: "idf_credential",
    type: "credential",
    accessToken: null,
    refreshToken: null,
    idToken: null,
    password: await context.password.hash(PASSWORD),
    scope: null,
    tokenType: null,
    sessionState: null,
    expiresAtMs: null,
    extExpiresIn: null,
  });
}

describe("better-auth over the identity account adapter", () => {
  let h: Harness;

  beforeEach(() => {
    h = harness();
  });

  describe("given an organization nobody has enrolled", () => {
    /** @scenario "Signing up on an unmigrated organization writes nothing extra" */
    it("signs up and signs in entirely on the legacy table", async () => {
      await signUp(h, "legacy@acme.com");

      // The gate is closed, so no ceremony ran, no identifier exists, and
      // better-auth's own row is the one and only truth — exactly what
      // happens today with none of this wired.
      expect(h.db.account).toHaveLength(1);
      expect(h.credentials.rows.size).toBe(0);
      expect(h.heads.heads.size).toBe(0);
      expect(h.commands).toHaveLength(0);

      const signedIn = await h.auth.api.signInEmail({
        body: { email: "legacy@acme.com", password: PASSWORD },
      });
      expect(signedIn.user.email).toBe("legacy@acme.com");
    });
  });

  describe("given a user the backfill has adopted", () => {
    const USER_ID = "user_backfilled";
    const EMAIL = "backfilled@acme.com";

    beforeEach(async () => {
      h.gateOpen.value = true;
      await backfilledUser(h, { userId: USER_ID, email: EMAIL });
    });

    /**
     * PINS A KNOWN DEFECT, and must be inverted when it is fixed.
     *
     * A user the backfill has adopted CANNOT sign in through this adapter.
     * The reason is structural, not a slip:
     *
     *   better-auth's `findUserByEmail(email, { includeAccounts: true })`
     *   asks for the user with `join: { account: true }`. Joins are off by
     *   default (`advanced.database.joins`), so `createAdapterFactory`
     *   satisfies the join ITSELF, with a second query issued through the
     *   adapter instance the factory was built around. This class wraps a
     *   FINISHED adapter, so it sits ABOVE that factory and never sees the
     *   second query — it reads the legacy `account` table directly, finds
     *   nothing for a migrated user, and better-auth reports "Credential
     *   account not found".
     *
     * Wrapping a built adapter can therefore never intercept a model
     * completely: the factory's own traffic is below the wrapper. Serving a
     * model from different storage has to happen at or below the factory,
     * not above it.
     */
    it("cannot sign in: the factory's own join query reads below the adapter", async () => {
      expect(h.db.account).toHaveLength(0);

      await expect(
        h.auth.api.signInEmail({ body: { email: EMAIL, password: PASSWORD } }),
      ).rejects.toThrow();
    });

    /** @scenario "better-auth reads an account from the identifiers" */
    it("does answer the queries the adapter is actually asked directly", async () => {
      // The interception itself is sound — every account query better-auth
      // issues THROUGH this adapter is answered from the projection. What
      // fails above is only the traffic that never reaches it.
      const adapter = (await h.auth.$context).adapter;

      const row = await adapter.findOne({
        model: "account",
        where: [
          { field: "userId", value: USER_ID },
          { field: "providerId", value: "credential" },
        ],
      });

      expect(row).toMatchObject({
        id: "acc_credential",
        userId: USER_ID,
        providerId: "credential",
      });
      expect(h.db.account).toHaveLength(0);
    });
  });

  describe("given a latched user signing up for the first time", () => {
    /**
     * The known limit, pinned deliberately rather than left to be
     * rediscovered.
     *
     * better-auth creates the `User` and the `Account` inside ONE
     * transaction, and the attach ceremony reads the user's email through
     * the app's own client — a different connection, which cannot see a row
     * the transaction has not committed. So the ceremony finds no email,
     * attaches nothing, and better-auth writes its legacy row.
     *
     * That degrades safely: the user is simply adopted by the backfill's
     * next pass instead of at the moment they sign up, and until then their
     * legacy row is their one truth, exactly as ADR-116's fallback intends.
     * It is a gap in the LIVE path, not a correctness bug — but it does mean
     * the live attach currently fires on linking, not on sign-up.
     */
    it("writes the legacy row and defers the attach to the backfill", async () => {
      h.gateOpen.value = true;

      await signUp(h, "brandnew@acme.com");

      expect(h.commands).toHaveLength(0);
      expect(h.heads.heads.size).toBe(0);
      expect(h.db.account).toHaveLength(1);
      expect(h.credentials.rows.size).toBe(0);
    });
  });
});
