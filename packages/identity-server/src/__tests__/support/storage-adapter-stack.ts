import {
  type IdentityCommand,
  type IdentityFact,
  type IdentityFactInput,
} from "@langwatch/identity";
import type { BetterAuthOptions, BetterAuthPlugin } from "better-auth";
import { betterAuth } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";
import {
  bridgeAccountCeremonies,
  IdentityCeremonies,
} from "../../better-auth/identity-ceremonies";
import {
  createIdentityStorageAdapter,
  type PasskeyRemovalPort,
} from "../../better-auth/identity-storage-adapter";
import type {
  IdentityAccountsPort,
  IdentityResolutionPort,
} from "../../better-auth/storage-ports";
import { IdentityGuards } from "../../guards";
import {
  newIdentityCommandId,
} from "../../identity-command-id";
import type { IdentityLedger } from "../../identity-ledger";
import type { IdentityUsersRepository } from "../../identity-users.repository";
import { IdentityService } from "../../identity.service";
import {
  InMemoryIdentityEventStore,
  inMemoryIdentityLedger,
} from "./in-memory-event-store";
import { InMemoryHeads, T0 } from "./in-memory-heads";
import { InMemoryReservations } from "./in-memory-reservations";
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
  passkey: [],
});

/**
 * The adapter tests exercise the passkey table without mounting the browser
 * passkey endpoints. Keep the real plugin schema here so Better Auth validates
 * those direct adapter calls against the same row shape as production.
 */
const passkeySchemaPlugin: BetterAuthPlugin = {
  id: "passkey",
  schema: {
    passkey: {
      fields: {
        name: { type: "string", required: false },
        publicKey: { type: "string", required: true },
        userId: {
          type: "string",
          references: { model: "user", field: "id" },
          required: true,
          index: true,
        },
        credentialID: {
          type: "string",
          required: true,
          index: true,
        },
        counter: { type: "number", required: true },
        deviceType: { type: "string", required: true },
        backedUp: { type: "boolean", required: true },
        transports: { type: "string", required: false },
        createdAt: { type: "date", required: false },
        aaguid: { type: "string", required: false },
      },
    },
  },
};

/**
 * One `betterAuth()` shape for both stacks, differing only in the engine.
 * Sharing the literal keeps their inferred `Auth<Options>` types the same,
 * which is what lets one walk drive either of them.
 */
function authOver(
  database: BetterAuthOptions["database"],
  databaseHooks?: BetterAuthOptions["databaseHooks"],
) {
  return betterAuth({
    baseURL: "http://localhost:3000",
    secret: "test-secret-test-secret-test-secret",
    database,
    plugins: [passkeySchemaPlugin],
    emailAndPassword: { enabled: true },
    ...(databaseHooks === undefined ? {} : { databaseHooks }),
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
  /** The migration-state rows the identifier backfill writes, by user
   *  (ADR-116 §2). An adopted user's says `finalized`. */
  migrationState: Map<string, "migrated" | "finalized">;
  /** The event-sourcing stack, as a ceremony finds it. Turned off, the
   *  append throws. */
  engine: { available: boolean };
  /** Every fact that LANDED, by its `commandId:index` key. A retry
   *  restates facts the store already holds and they are absorbed, so
   *  this is also the count of what a retry did NOT duplicate. */
  events: InMemoryIdentityEventStore;
}

/**
 * better-auth over the identity storage adapter (ADR-116 §1), with the same
 * memory engine underneath as the legacy branch.
 *
 * `databaseHooks` are OFF by default. The adapter has to state its own facts
 * — ADR-116 §5's move from a hook-level veto to a storage-level one — and a
 * suite that always wired the hooks could not tell which of the two did it.
 * `withDatabaseHooks` turns on the application's own composition, hooks and
 * adapter together, which is the one arrangement that can prove they do not
 * both state the fact.
 *
 * `inert` gives the ports nothing to answer with and makes every identity
 * WRITE throw, so a closed gate that nevertheless put a row into identity
 * storage fails the suite rather than passing quietly.
 */
/**
 * The memory engine standing in for the current legacy Prisma account table.
 * Account now has an issuer column; the wrapper remains the named fixture for
 * tests that pin translation against that real schema rather than against an
 * earlier, issuer-less version of it.
 */
function schemaBoundLegacyEngine(db: MemoryDB) {
  return memoryAdapter(db);
}

export function identityStack({
  inert = false,
  withDatabaseHooks = false,
  schemaBoundLegacy = false,
  passkeyRemoval,
}: {
  inert?: boolean;
  withDatabaseHooks?: boolean;
  /** Use the named fixture that represents the current Prisma account shape. */
  schemaBoundLegacy?: boolean;
  passkeyRemoval?: PasskeyRemovalPort;
} = {}): IdentityStack {
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

  /** The event store the ledger appends through — carrying the real store's
   *  `commandId:index` idempotency, which is what makes a retried ceremony
   *  converge here for the same reason it converges in production. */
  const events = new InMemoryIdentityEventStore();
  const ledger = inMemoryIdentityLedger({
    heads,
    events,
    commands,
    // The shape the app's ledger fails in when the event stack is down: a
    // plain Error, which degrades to "unknown" at the boundary and carries
    // its trace id into the log.
    refuse: () =>
      engine.available
        ? null
        : "identity ledger cannot append: the event-sourcing stack is unavailable",
  });

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

  const reservations = new InMemoryReservations();

  const storage = new InMemoryIdentityStorage(
    heads,
    (userId) => finalized.is(userId),
    db.account ?? [],
  );
  const isUserOnIdentityWrites = async ({ userId }: { userId: string }) =>
    gate.open(userId);
  /** The fleet-level short-circuit, answered from the same two sources the
   *  per-user fork reads rather than a third one kept in step by hand. */
  const isAnyoneOnIdentityWrites = async () =>
    (db.user ?? []).some(
      (row) => typeof row.id === "string" && gate.open(row.id),
    ) || [...migrationState.values()].includes("finalized");

  const identity = new IdentityService(
    new IdentityGuards(heads, users, reservations),
    ledger,
  );

  const ceremonies = new IdentityCeremonies(
    heads,
    users,
    identity,
    isUserOnIdentityWrites,
    { now: () => T0, newCommandId: newIdentityCommandId },
  );

  const accounts: IdentityAccountsPort = inert
    ? inertIdentityPorts.accounts
    : storage;
  const resolution: IdentityResolutionPort = inert
    ? inertIdentityPorts.resolution
    : storage;

  const bridge = bridgeAccountCeremonies({
    ceremonies,
    routesToIdentity: isUserOnIdentityWrites,
  });
  const auth = authOver(
    createIdentityStorageAdapter({
      legacyEngine: schemaBoundLegacy
        ? schemaBoundLegacyEngine(db)
        : memoryAdapter(db),
      passkeyRemoval: passkeyRemoval ?? {
        deleteIfAnotherWayInRemains: async ({ passkeyId }) => {
          const passkeys = db.passkey ?? [];
          const index = passkeys.findIndex((row) => row.id === passkeyId);
          if (index < 0) {
            return "not_found";
          }
          passkeys.splice(index, 1);
          return "deleted";
        },
      },
      accounts,
      resolution,
      ceremonies,
      isUserOnIdentityWrites,
      isAnyoneOnIdentityWrites,
    }),
    // The application's own wiring, verbatim: the account ceremonies bound to
    // better-auth's `databaseHooks` alongside the adapter that also runs them.
    withDatabaseHooks
      ? {
          account: {
            create: { before: (account) => bridge.beforeAccountCreate(account) },
            delete: { before: (account) => bridge.beforeAccountDelete(account) },
          },
        }
      : undefined,
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
    events,
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

