import type {
  IdentityCommand,
  IdentityFact,
  IdentityFactInput,
} from "@langwatch/identity";
import type { BetterAuthOptions } from "better-auth";
import { betterAuth } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";
import { IdentityCeremonies } from "../../better-auth/identity-ceremonies";
import { createIdentityStorageAdapter } from "../../better-auth/identity-storage-adapter";
import type {
  IdentityAccountsPort,
  IdentityResolutionPort,
} from "../../better-auth/storage-ports";
import { IdentityGuards } from "../../guards";
import { newIdentityCommandId } from "../../identity-command-id";
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
  const finalized = { is: (userId: string) => gate.open(userId) };

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

  const storage = new InMemoryIdentityStorage(
    heads,
    (userId) => finalized.is(userId),
    db.account ?? [],
  );
  const isUserOnIdentityWrites = async ({ userId }: { userId: string }) =>
    gate.open(userId);

  const ceremonies = new IdentityCeremonies(
    heads,
    users,
    new IdentityService(new IdentityGuards(heads), ledger),
    isUserOnIdentityWrites,
    { now: () => T0, newCommandId: newIdentityCommandId },
  );

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
    }),
  );

  return { auth, db, heads, storage, commands, gate, finalized };
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
