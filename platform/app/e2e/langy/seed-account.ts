// A person of their own for a scenario, written into the database of the local
// stack under test.
//
// Registration (`user.register`) asks for the proof an emailed link hands out,
// and a scenario has no mailbox to read. So the account is seeded the way
// `scripts/seed-dogfood-password.ts` seeds one: a verified user plus the
// credential account the email sign-in looks up. Only ever on this machine:
// the app under test and its database must both be on a loopback address.

import { readFileSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { hash } from "bcrypt";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_DOTENV = path.resolve(__dirname, "../../.env");

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

const hostOf = (address: string): string | null => {
  try {
    return new URL(address).hostname.toLowerCase();
  } catch {
    return null;
  }
};

/**
 * How an error names an address: its host and nothing else. A user, a
 * password or a token can sit in the authority, the path or the query of a
 * database address, and an error ends up in a CI log.
 */
const hostForError = (host: string | null): string =>
  host ?? "an address that does not parse";

/** `DATABASE_URL` as the app's own `.env` spells it, or undefined. */
export function databaseUrlFromDotenv(dotenv: string): string | undefined {
  const value = /^DATABASE_URL=(.*)$/m.exec(dotenv)?.[1]?.trim();
  if (!value) return undefined;
  return value.replace(/^["']|["']$/g, "");
}

/**
 * The database a scenario may seed an account into: the one the environment
 * names, or the one in the app's own `.env`. Throws when the app under test
 * or that database is not on this machine, naming the host.
 */
export function resolveSeedDatabaseUrl({
  appBase,
  env,
  readDotenv,
}: {
  appBase: string;
  env: Record<string, string | undefined>;
  readDotenv: () => string | undefined;
}): string {
  const appHost = hostOf(appBase);
  if (!appHost || !LOOPBACK_HOSTS.has(appHost)) {
    throw new Error(
      `A scenario's own account is only seeded on a local stack, and the app under test is on ${hostForError(appHost)}.`,
    );
  }
  const dotenv = env.DATABASE_URL ? undefined : readDotenv();
  const databaseUrl =
    env.DATABASE_URL ?? (dotenv ? databaseUrlFromDotenv(dotenv) : undefined);
  if (!databaseUrl) {
    throw new Error(
      "A scenario's own account needs the local stack's database: set DATABASE_URL, or keep it in platform/app/.env.",
    );
  }
  const databaseHost = hostOf(databaseUrl);
  if (!databaseHost || !LOOPBACK_HOSTS.has(databaseHost)) {
    throw new Error(
      `A scenario's own account is only seeded in a database on this machine, and DATABASE_URL points at ${hostForError(databaseHost)}.`,
    );
  }
  return databaseUrl;
}

/** The two rows an email sign-in needs, behind a port so a test can stand in. */
export interface AccountStore {
  findUserIdByEmail(email: string): Promise<string | null>;
  /**
   * Writes the verified user and its password account together: both rows or
   * neither. A user left without its account cannot sign in, and the next run
   * would refuse its address as taken.
   */
  createVerifiedUserWithPassword(account: {
    name: string;
    email: string;
    passwordHash: string;
  }): Promise<string>;
  close(): Promise<void>;
}

/** Writes the account, and closes the store whatever happens. */
export async function seedCredentialAccount({
  name,
  email,
  password,
  store,
}: {
  name: string;
  email: string;
  password: string;
  store: AccountStore;
}): Promise<{ userId: string }> {
  try {
    const existing = await store.findUserIdByEmail(email);
    if (existing) {
      throw new Error(`An account for ${email} already exists.`);
    }
    const userId = await store.createVerifiedUserWithPassword({
      name,
      email,
      passwordHash: await hash(password, 10),
    });
    return { userId };
  } finally {
    await store.close();
  }
}

/** The store over the local stack's database. */
export async function openLocalAccountStore({
  appBase,
}: {
  appBase: string;
}): Promise<AccountStore> {
  const databaseUrl = resolveSeedDatabaseUrl({
    appBase,
    env: process.env,
    readDotenv: () => {
      try {
        return readFileSync(APP_DOTENV, "utf8");
      } catch {
        return undefined;
      }
    },
  });
  const { PrismaClient } = await import("../../src/generated/prisma/client");
  const { createPrismaPgAdapter } = await import(
    "../../src/server/prismaPgAdapter"
  );
  const prisma = new PrismaClient({
    adapter: createPrismaPgAdapter(databaseUrl),
  });
  return {
    findUserIdByEmail: async (email) =>
      (await prisma.user.findUnique({ where: { email }, select: { id: true } }))
        ?.id ?? null,
    createVerifiedUserWithPassword: ({ name, email, passwordHash }) =>
      // One transaction, since the account's id is the user's id and so the
      // user has to exist before the account can be written.
      prisma.$transaction(async (tx) => {
        const { id: userId } = await tx.user.create({
          data: { name, email, emailVerified: true },
          select: { id: true },
        });
        await tx.account.create({
          data: {
            userId,
            type: "credentials",
            provider: "credential",
            // better-auth keys an account by `(issuer, accountId)`, and the
            // local credential provider's issuer is `local:credential`.
            issuer: "local:credential",
            providerAccountId: userId,
            password: passwordHash,
          },
        });
        return userId;
      }),
    close: () => prisma.$disconnect(),
  };
}
