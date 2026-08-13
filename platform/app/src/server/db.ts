import { type Prisma, PrismaClient } from "~/generated/prisma/client";
import { env } from "../env.mjs";
import type { GuardNext, GuardParams } from "../utils/dbGuardMiddleware";
import { guardEnMasse } from "../utils/dbMassDeleteProtection";
import { guardProjectId } from "../utils/dbMultiTenancyProtection";
import { guardOrganizationId } from "../utils/dbOrganizationIdProtection";
import { createPrismaPgAdapter } from "./prismaPgAdapter";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

/**
 * Runs the guard chain in the order `$use` used to register it
 * (enMasse → projectId → organizationId), then executes the query with
 * whatever args the guards left behind (guardEnMasse rewrites the safe-word
 * where clauses).
 */
const withGuards = (
  params: GuardParams,
  execute: (args: unknown) => Promise<unknown>,
): Promise<unknown> => {
  const run: GuardNext = (p) =>
    guardProjectId(p, (q) => guardOrganizationId(q, (r) => execute(r.args)));
  return guardEnMasse(params, run);
};

const createGuardedPrismaClient = (): PrismaClient => {
  const client = new PrismaClient({
    // The process-env fallback mirrors the classic engine, which resolved the
    // schema's `env("DATABASE_URL")` from process.env itself — test suites
    // that mock `~/env.mjs` with a partial env relied on that.
    adapter: createPrismaPgAdapter(
      env.DATABASE_URL ?? process.env.DATABASE_URL ?? "",
    ),
    log: env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });

  // Prisma 7 removed `$use`; the query extension below is its replacement and
  // covers the same surface the middlewares saw: every top-level model
  // operation plus the raw entry points. The extension does not change any
  // result or argument types (the guards only validate and throw), so the
  // extended client is handed back out under the plain PrismaClient type the
  // rest of the codebase is written against.
  return client.$extends({
    query: {
      $allModels: {
        $allOperations({ model, operation, args, query }) {
          return withGuards({ model, action: operation, args }, (a) =>
            query(a as typeof args),
          );
        },
      },
      $queryRaw({ args, query }) {
        return withGuards({ action: "queryRaw", args }, (a) =>
          query(a as typeof args),
        );
      },
      $queryRawUnsafe({ args, query }) {
        return withGuards({ action: "queryRaw", args }, (a) =>
          query(a as typeof args),
        );
      },
      $executeRaw({ args, query }) {
        return withGuards({ action: "executeRaw", args }, (a) =>
          query(a as typeof args),
        );
      },
      $executeRawUnsafe({ args, query }) {
        return withGuards({ action: "executeRaw", args }, (a) =>
          query(a as typeof args),
        );
      },
    },
  }) as unknown as PrismaClient;
};

/**
 * Whether `client` is the root client rather than an interactive-transaction
 * client. Prisma 7 removed `$transaction` from the transaction deny list —
 * transaction clients now carry a callable `$transaction` — so checking for it
 * stopped discriminating anything. `$connect` is still denied on transaction
 * clients; that judgment lives here, once, next to the client it describes.
 */
export const isRootPrismaClient = (
  client: PrismaClient | Prisma.TransactionClient,
): client is PrismaClient => "$connect" in client;

let lazyClient: PrismaClient | undefined;

const getClient = (): PrismaClient => {
  if (lazyClient) return lazyClient;
  lazyClient = globalForPrisma.prisma ?? createGuardedPrismaClient();
  if (env.NODE_ENV !== "production") globalForPrisma.prisma = lazyClient;
  return lazyClient;
};

/**
 * Lazy: importing this module must not construct a client (and with it a pg
 * pool and an engine instance). Half the server graph reaches this file
 * transitively, so scripts, workers and unit suites that never touch Postgres
 * would otherwise all pay for — and need env for — a database they don't use.
 * The first property access constructs the real client; every delegate and
 * method is then served off that one instance (Prisma memoizes delegates, so
 * `prisma.project` is stable and spies on it hold).
 */
export const prisma: PrismaClient = new Proxy({} as PrismaClient, {
  get(_target, prop, _receiver) {
    const client = getClient() as unknown as Record<string | symbol, unknown>;
    const value = client[prop];
    return typeof value === "function"
      ? (value as (...args: unknown[]) => unknown).bind(client)
      : value;
  },
  has(_target, prop) {
    return prop in (getClient() as object);
  },
});
