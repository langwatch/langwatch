import {
  type IdentityCommand,
  type IdentityFact,
  type IdentityFactInput,
  normalizeIdentifierValue,
} from "@langwatch/identity";
import type { BetterAuthOptions } from "better-auth";
import { betterAuth } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";
import { deriveNewbornUserId } from "../../crypto/identifier-identity";
import {
  birthAwareGate,
  type IdentityBirthPort,
  IdentityEngineUnavailableError,
  runWithIdentityBirth,
} from "../../better-auth/identity-birth";
import { IdentityCeremonies } from "../../better-auth/identity-ceremonies";
import { createIdentityStorageAdapter } from "../../better-auth/identity-storage-adapter";
import type {
  IdentityAccountsPort,
  IdentityResolutionPort,
} from "../../better-auth/storage-ports";
import { IdentityGuards } from "../../guards";
import {
  adoptUserEmailCommandId,
  newIdentityCommandId,
} from "../../identity-command-id";
import type { IdentityLedger } from "../../identity-ledger";
import type { IdentityUsersRepository } from "../../identity-users.repository";
import { IdentityService } from "../../identity.service";
import { InMemoryHeads, T0 } from "./in-memory-heads";
import {
  inertIdentityPorts,
  InMemoryIdentityStorage,
} from "./in-memory-identity-storage";

export const PASSWORD = "correct-horse-battery";
export const NEW_PASSWORD = "staple-battery-horse";

export type MemoryDB = Record<string, Record<string, unknown>[]>;

const emptyDb = (): MemoryDB => ({
  user: [],
  session: [],
  account: [],
  verification: [],
});

/**
 * One `betterAuth()` shape for both stacks, differing only in the engine.
 * Sharing the literal keeps their inferred `Auth<Options>` types the same,
 * which is what lets one walk drive either of them.
 */
function authOver(database: BetterAuthOptions["database"]) {
  return betterAuth({
    baseURL: "http://localhost:3000",
    secret: "test-secret-test-secret-test-secret",
    database,
    emailAndPassword: { enabled: true },
  });
}

export type AuthUnderTest = ReturnType<typeof authOver>;

/** better-auth over the completely stock engine — the behavior the
 *  unlatched branch has to reproduce byte for byte. */
export function stockStack(): { auth: AuthUnderTest; db: MemoryDB } {
  const db = emptyDb();
  return { auth: authOver(memoryAdapter(db)), db };
}

export interface IdentityStack {
  auth: AuthUnderTest;
  db: MemoryDB;
  heads: InMemoryHeads;
  storage: InMemoryIdentityStorage;
  commands: IdentityCommand[];
  /** The per-user WRITE gate: cached, and the thing that fails closed. */
  gate: { open: (userId: string) => boolean };
  /**
   * The migration-state row resolution joins into its own query, which the
   * gate's cache cannot make stale (ADR-116 §2). It follows the gate by
   * default; a suite that wants the two to disagree — a gate outage — sets
   * this one first and then closes the gate.
   */
  finalized: { is: (userId: string) => boolean };
  /** The migration-state rows the born-finalized entrance writes, by user
   *  (ADR-116 §3). A newborn's says `finalized`; an entrance that failed
   *  before its rows committed leaves the claim it wrote before the append. */
  migrationState: Map<string, "migrated" | "finalized">;
  /** The event-sourcing stack, as the entrance finds it. Turned off, the
   *  append throws and the sign-up must fail rather than fall back. */
  engine: { available: boolean };
}

/**
 * better-auth over the identity storage adapter (ADR-116 §1), with the same
 * memory engine underneath as the legacy branch.
 *
 * There are deliberately NO `databaseHooks` here. The application still binds
 * them during the bridge phase, but the adapter has to state its own facts —
 * ADR-116 §5's move from a hook-level veto to a storage-level one — and a
 * suite that wired the hooks could not tell which of the two did it.
 *
 * `inert` gives the ports nothing to answer with and makes every identity
 * WRITE throw, so a closed gate that nevertheless put a row into identity
 * storage fails the suite rather than passing quietly.
 */
export function identityStack({
  inert = false,
}: { inert?: boolean } = {}): IdentityStack {
  const db = emptyDb();
  const heads = new InMemoryHeads();
  const commands: IdentityCommand[] = [];
  const gate = { open: (_userId: string) => false };
  const migrationState = new Map<string, "migrated" | "finalized">();
  const engine = { available: true };
  const finalized = {
    is: (userId: string) =>
      migrationState.get(userId) === "finalized" || gate.open(userId),
  };

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
      if (!engine.available) {
        // The shape the app's ledger fails in when the event stack is down:
        // a plain Error, which the entrance is what turns into a handled
        // `identity_engine_unavailable`.
        throw new Error(
          "identity ledger cannot append: the event-sourcing stack is unavailable",
        );
      }
      commands.push(command);
      heads.fold((command.data as { userId: string }).userId, facts, T0);
      return facts.map((f) => ({ ...f, occurredAt: T0 }) as IdentityFact);
    },
  };

  /** `User` as identity reads it: the memory engine's own rows, so the
   *  legacy population the collision guard consults is the same one
   *  better-auth is writing. */
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

  const storage = new InMemoryIdentityStorage(
    heads,
    (userId) => finalized.is(userId),
    db.account ?? [],
  );
  const isUserOnIdentityWrites = async ({ userId }: { userId: string }) =>
    gate.open(userId);

  const identity = new IdentityService(
    new IdentityGuards(heads, users),
    ledger,
  );

  const ceremonies = new IdentityCeremonies(
    heads,
    users,
    identity,
    // The ceremonies fork on the SAME question the adapter does, and a
    // newborn whose adapter routed to identity while their ceremony declined
    // would get a legacy `Account` row anyway (ADR-116 §3).
    birthAwareGate(isUserOnIdentityWrites),
    { now: () => T0, newCommandId: newIdentityCommandId },
  );

  /**
   * The born-finalized entrance, in memory, in the legs ADR-116 §3 pins:
   * the waited append first, then the row writes, then the projection.
   *
   * The ids are the entrance's own — the user id derived from the address so
   * a retry converges, the command id the one the BACKFILL would have used
   * for `User.email`, so the entrance and a later adoption pass state the
   * same command and the store dedupes rather than duplicating.
   */
  const birth: IdentityBirthPort = {
    async bear({ row, email, createdAtMs }) {
      const normalizedValue = normalizeIdentifierValue(email);
      const userId = deriveNewbornUserId({ normalizedValue });
      migrationState.set(userId, "migrated");
      try {
        await identity.attachIdentifier({
          tenantId: userId,
          userId,
          commandId: adoptUserEmailCommandId({ userId }),
          accountId: null,
          provider: "email",
          providerAccountId: null,
          value: email,
          occurredAtMs: createdAtMs,
          ceremony: { flow: "better-auth" },
          actor: { type: "user", id: userId },
        });
      } catch (error) {
        throw new IdentityEngineUnavailableError(
          "the born-finalized entrance could not append the newborn's identity facts",
          error,
        );
      }
      const written = { ...row, id: userId };
      db.user?.push(written);
      migrationState.set(userId, "finalized");
      return written;
    },
  };

  const accounts: IdentityAccountsPort = inert
    ? inertIdentityPorts.accounts
    : storage;
  const resolution: IdentityResolutionPort = inert
    ? inertIdentityPorts.resolution
    : storage;

  const auth = authOver(
    createIdentityStorageAdapter({
      legacyEngine: memoryAdapter(db),
      accounts,
      resolution,
      ceremonies,
      isUserOnIdentityWrites,
      birth,
    }),
  );

  return {
    auth,
    db,
    heads,
    storage,
    commands,
    gate,
    finalized,
    migrationState,
    engine,
  };
}

export async function signUp(
  auth: AuthUnderTest,
  email: string,
): Promise<string> {
  const response = await auth.api.signUpEmail({
    body: { email, password: PASSWORD, name: "Sam" },
    asResponse: true,
  });
  return response.headers.get("set-cookie") ?? "";
}

/**
 * A sign-up whose request carries the identity-branch opt-in — what the auth
 * route boundary does once the backend feature-flag check passes (ADR-116
 * §3). Nothing below the marker re-decides the flag.
 */
export function flaggedSignUp(
  auth: AuthUnderTest,
  email: string,
): Promise<string> {
  return runWithIdentityBirth(() => signUp(auth, email));
}

/**
 * The same sign-up, driven so that a failure THROWS rather than becoming a
 * response. `asResponse` turns better-auth's own error handling into a
 * status code, which is the wrong lens for asserting that a refusal kept its
 * handled code all the way out.
 */
export function flaggedSignUpOrThrow(
  auth: AuthUnderTest,
  email: string,
): Promise<unknown> {
  return runWithIdentityBirth(() =>
    auth.api.signUpEmail({
      body: { email, password: PASSWORD, name: "Sam" },
    }),
  );
}
