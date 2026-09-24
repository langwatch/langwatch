import {
  type IdentityCommand,
  IdentityEngineUnavailableError,
  normalizeIdentifierValue,
} from "@langwatch/identity-contract";
import type { BetterAuthOptions, BetterAuthPlugin } from "better-auth";
import { betterAuth } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";

import { type IdentityBirth } from "../../app/identity.members.ts";
import type { IdentityUsersRepository } from "../../repositories/identity-users.repository.ts";
import { deriveNewbornUserId } from "../../rules/identifier-hash.rules.ts";
import {
  adoptUserEmailCommandId,
  newIdentityCommandId,
} from "../../rules/identity-command-id.rules.ts";
import type { IdentityAccounts, IdentityResolver } from "../../rules/identity-storage.rules.ts";
import { BetterAuthCeremonyBridgeService } from "../../services/better-auth-ceremony-bridge.service.ts";
import { BetterAuthIdentityBirthAdapter } from "../../services/better-auth-identity-birth.service.ts";
import { IdentityCeremoniesService } from "../../services/better-auth-identity-ceremonies.service.ts";
import {
  BetterAuthIdentityStorageService,
  type PasskeyRemoval,
} from "../../services/better-auth-identity-storage.service.ts";
import { CryptoIdentifierIdentityAdapter } from "../../services/crypto-identifier-identity.service.ts";
import { IdentityGuardsService } from "../../services/identity-guards.service.ts";
import { IdentityService } from "../../services/identity.service.ts";
import { InMemoryIdentityEventStore, inMemoryIdentityLedger } from "./in-memory-event-store.ts";
import { InMemoryHeads, T0 } from "./in-memory-heads.ts";
import { inertIdentityPorts, InMemoryIdentityStorage } from "./in-memory-identity-storage.ts";
import { InMemoryReservations } from "./in-memory-reservations.ts";

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
        credentialID: { type: "string", required: true, index: true },
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
   * The migration-state row resolution joins into its own query, which the default; a suite that
   * wants the two to disagree — a gate outage — sets this one first and then closes the gate.
   * gate's cache cannot make stale (ADR-116 §2). It follows the gate by
   */
  finalized: { is: (userId: string) => boolean };
  /** The migration-state rows the born-finalized entrance writes, by user
   *  (ADR-116 §3). A newborn's says `finalized`; an entrance that failed
   *  before its rows committed leaves the claim it wrote before the append. */
  migrationState: Map<string, "migrated" | "finalized">;
  /** The event-sourcing stack, as the entrance finds it. Turned off, the
   *  append throws and the sign-up must fail rather than fall back. */
  engine: { available: boolean };
  /** Every fact that LANDED, by its `commandId:index` key. A retry
   *  restates facts the store already holds and they are absorbed, so
   *  this is also the count of what a retry did NOT duplicate. */
  events: InMemoryIdentityEventStore;
}

/**
 * The memory engine standing in for the current legacy Prisma account table
 * (now with an issuer column). Named so tests pin translation against that
 * real schema, not an earlier, issuer-less version.
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
  passkeyRemoval?: PasskeyRemoval;
} = {}): IdentityStack {
  const db = emptyDb();
  const heads = new InMemoryHeads();
  const commands: IdentityCommand[] = [];
  const gate = { open: (_userId: string) => false };
  const migrationState = new Map<string, "migrated" | "finalized">();
  const engine = { available: true };
  const finalized = {
    is: (userId: string) => migrationState.get(userId) === "finalized" || gate.open(userId),
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
    // plain Error, which the entrance is what turns into a handled
    // `identity_engine_unavailable`.
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
    async getUserEmail({ userId }) {
      const row = db.user?.find((candidate) => candidate.id === userId);
      return { email: typeof row?.email === "string" ? row.email : null };
    },
    async findAddressStanding({ userId }) {
      const row = db.user?.find((candidate) => candidate.id === userId);
      if (!row) return null;
      const email = typeof row.email === "string" ? row.email : null;
      return { email, emailVerified: row.emailVerified === true, holders: email ? 1 : 0 };
    },
    async findUserIdsByEmail({ normalizedValue }) {
      return (db.user ?? []).flatMap((candidate) =>
        typeof candidate.email === "string" &&
        typeof candidate.id === "string" &&
        candidate.email.toLowerCase() === normalizedValue.toLowerCase()
          ? [candidate.id]
          : [],
      );
    },
  };

  const reservations = new InMemoryReservations();

  const storage = new InMemoryIdentityStorage(
    heads,
    (userId) => finalized.is(userId),
    db.account ?? [],
  );
  const isUserOnIdentityWrites = async ({ userId }: { userId: string }) => gate.open(userId);
  /** The fleet-level short-circuit, answered from the same two sources the
   *  per-user fork reads rather than a third one kept in step by hand. */
  const isAnyoneOnIdentityWrites = async () =>
    (db.user ?? []).some((row) => typeof row.id === "string" && gate.open(row.id)) ||
    [...migrationState.values()].includes("finalized");

  const identity = IdentityService.create(
    IdentityGuardsService.create({
      heads,
      users,
      reservations,
      identifiers: CryptoIdentifierIdentityAdapter.create(),
    }),
    ledger,
  );

  const ceremonies = IdentityCeremoniesService.create({
    heads,
    users,
    identity,
    // The ceremonies fork on the SAME question the adapter does, and a
    // newborn whose adapter routed to identity while their ceremony declined
    // would get a legacy `Account` row anyway (ADR-116 §3).
    isLatched: BetterAuthIdentityBirthAdapter.birthAwareGate(isUserOnIdentityWrites),
    clock: { now: () => T0, newCommandId: newIdentityCommandId },
  });

  /**
   * the waited append first, then the row writes, then the projection.
   * The born-finalized entrance, in memory, in the legs ADR-116 §3 pins:
   */
  const birth: IdentityBirth = {
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
          providerId: null,
          issuer: null,
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

  const accounts: IdentityAccounts = inert ? inertIdentityPorts.accounts : storage;
  const resolution: IdentityResolver = inert ? inertIdentityPorts.resolution : storage;

  const bridge = BetterAuthCeremonyBridgeService.create({
    ceremonies,
    routesToIdentity: BetterAuthIdentityBirthAdapter.birthAwareGate(isUserOnIdentityWrites),
  });
  const auth = authOver(
    BetterAuthIdentityStorageService.create({
      legacyEngine: schemaBoundLegacy ? schemaBoundLegacyEngine(db) : memoryAdapter(db),
      accounts,
      resolution,
      ceremonies,
      isUserOnIdentityWrites,
      isAnyoneOnIdentityWrites,
      birth,
      // A stack that names no removal port is testing something else; the
      // refusal keeps a passkey delete from quietly taking the legacy path.
      passkeyRemoval: passkeyRemoval ?? {
        deleteIfAnotherWayInRemains: async () => "not_found",
      },
    }).factory(),
    // The application's own wiring, verbatim: the account ceremonies bound to
    // better-auth's `databaseHooks` alongside the adapter that also runs them.
    withDatabaseHooks
      ? {
          account: {
            create: {
              before: async (account) => {
                const pin = await bridge.createAccountIdentifier(account);
                return pin.pinned ? { data: pin.data } : undefined;
              },
            },
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

export async function signUp(auth: AuthUnderTest, email: string): Promise<string> {
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
export function flaggedSignUp(auth: AuthUnderTest, email: string): Promise<string> {
  return BetterAuthIdentityBirthAdapter.runWithIdentityBirth(() => signUp(auth, email));
}

/**
 * The same sign-up, driven so that a failure THROWS rather than becoming a response. `asResponse`
 * turns better-auth's own error handling into a status code, which is the wrong lens for asserting
 * that a refusal kept its handled code all the way out.
 */
export function flaggedSignUpOrThrow(auth: AuthUnderTest, email: string): Promise<unknown> {
  return BetterAuthIdentityBirthAdapter.runWithIdentityBirth(() =>
    auth.api.signUpEmail({
      body: { email, password: PASSWORD, name: "Sam" },
    }),
  );
}
