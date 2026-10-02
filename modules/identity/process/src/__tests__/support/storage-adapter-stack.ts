import type { IdentityCommand } from "@langwatch/identity-contract";
import type { BetterAuthOptions, BetterAuthPlugin } from "better-auth";
import { betterAuth } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";
import { createAuthEndpoint } from "better-auth/api";
import { handleOAuthUserInfo } from "better-auth/oauth2";
import { z } from "zod";

import type { IdentityUsersRepository } from "../../repositories/identity-users.repository.ts";
import { newIdentityCommandId } from "../../rules/identity-command-id.rules.ts";
import type { IdentityAccounts, IdentityResolver } from "../../rules/identity-storage.rules.ts";
import { BetterAuthCeremonyBridgeService } from "../../services/better-auth-ceremony-bridge.service.ts";
import { IdentityCeremoniesService } from "../../services/better-auth-identity-ceremonies.service.ts";
import {
  BetterAuthIdentityStorageService,
  type PasskeyRemoval,
} from "../../services/better-auth-identity-storage.service.ts";
import { CryptoIdentifierIdentityService } from "../../services/crypto-identifier-identity.service.ts";
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

/** One OAuth sign-in's payload, as better-auth's callback hands it to `handleOAuthUserInfo`. */
const oauthUserInfoBodySchema = z.object({
  userInfo: z.object({
    id: z.string(),
    email: z.string(),
    emailVerified: z.boolean(),
    name: z.string(),
    image: z.string().nullable(),
  }),
  account: z.object({
    providerId: z.string(),
    issuer: z.string(),
    accountId: z.string(),
    accessToken: z.string(),
    refreshToken: z.string(),
  }),
});

/**
 * Runs better-auth's own `handleOAuthUserInfo` inside a real endpoint context, so a suite drives
 * the sign-in token refresh the library constructs rather than a hand-built stand-in for it.
 */
const oauthUserInfoProbePlugin = {
  id: "oauth-user-info-probe",
  endpoints: {
    probeOAuthUserInfo: createAuthEndpoint(
      "/test/oauth-user-info",
      { method: "POST", body: oauthUserInfoBodySchema, metadata: { SERVER_ONLY: true } },
      (ctx) => handleOAuthUserInfo(ctx, ctx.body),
    ),
  },
} satisfies BetterAuthPlugin;

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
    plugins: [passkeySchemaPlugin, oauthUserInfoProbePlugin],
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
  /** The migration-state rows, by user (ADR-116 §2). */
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
      identifiers: CryptoIdentifierIdentityService.create(),
    }),
    ledger,
  );

  const ceremonies = IdentityCeremoniesService.create({
    heads,
    users,
    identity,
    // The ceremonies fork on the SAME question the adapter does (ADR-116 §2).
    isLatched: isUserOnIdentityWrites,
    clock: { now: () => T0, newCommandId: newIdentityCommandId },
  });

  const accounts: IdentityAccounts = inert ? inertIdentityPorts.accounts : storage;
  const resolution: IdentityResolver = inert ? inertIdentityPorts.resolution : storage;

  const bridge = BetterAuthCeremonyBridgeService.create({
    ceremonies,
    routesToIdentity: isUserOnIdentityWrites,
  });
  const auth = authOver(
    BetterAuthIdentityStorageService.create({
      legacyEngine: schemaBoundLegacy ? schemaBoundLegacyEngine(db) : memoryAdapter(db),
      accounts,
      resolution,
      ceremonies,
      isUserOnIdentityWrites,
      isAnyoneOnIdentityWrites,
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
