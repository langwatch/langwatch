import {
  PrismaConfigService,
  type PrismaConnection,
  PrismaConnectionService,
  PrismaQueryGuard,
  type PrismaQueryContext,
  type PrismaQueryExecutor,
  PrismaShutdownService,
} from "@langwatch/prisma-client";
import type { Prisma, PrismaClient } from "~/generated/prisma/client";
import { env } from "../env.mjs";
import type { GuardNext, GuardParams } from "../utils/dbGuardMiddleware";
import { guardEnMasse } from "../utils/dbMassDeleteProtection";
import { guardProjectId } from "../utils/dbMultiTenancyProtection";
import { guardOrganizationId } from "../utils/dbOrganizationIdProtection";
import { withQueryTiming } from "./dbSlowQueryWarning";

const globalForPrisma = globalThis as unknown as {
  prismaConnection: PrismaConnection | undefined;
};

/**
 * Runs the guard chain in the order `$use` used to register it
 * (enMasse → projectId → organizationId), then executes the query with
 * whatever args the guards left behind (guardEnMasse rewrites the safe-word
 * where clauses).
 *
 * Every model operation and every raw entry point funnels through here, which
 * is why the slow-query timing wraps it: this is the one place that sees them
 * all.
 */
const withGuards = (
  params: GuardParams,
  execute: (args: unknown) => Promise<unknown>,
): Promise<unknown> => {
  const run: GuardNext = (p) =>
    guardProjectId(p, (q) => guardOrganizationId(q, (r) => execute(r.args)));
  return withQueryTiming({ params, run: () => guardEnMasse(params, run) });
};

class AppPrismaQueryGuard extends PrismaQueryGuard {
  execute(context: PrismaQueryContext, next: PrismaQueryExecutor): Promise<unknown> {
    const params: GuardParams = {
      ...(context.model === void 0 ? {} : { model: context.model }),
      action: context.action,
      args: context.args,
    };
    return withGuards(params, next);
  }
}

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

let lazyConnection: PrismaConnection | undefined;

const createPrismaConnection = (): PrismaConnection => {
  const configuration = PrismaConfigService.create().resolve({
    databaseUrl: env.DATABASE_URL ?? process.env.DATABASE_URL ?? "",
    log: env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });
  return PrismaConnectionService.create({
    guard: new AppPrismaQueryGuard(),
  }).connect(configuration);
};

const getConnection = (): PrismaConnection => {
  if (lazyConnection) return lazyConnection;

  lazyConnection = globalForPrisma.prismaConnection ?? createPrismaConnection();
  if (env.NODE_ENV !== "production") {
    globalForPrisma.prismaConnection = lazyConnection;
  }
  return lazyConnection;
};

const getClient = (): PrismaClient => {
  return getConnection().client;
};

export async function closePrismaConnection(): Promise<void> {
  const connection = lazyConnection ?? globalForPrisma.prismaConnection;
  lazyConnection = void 0;
  globalForPrisma.prismaConnection = void 0;
  if (!connection) return;

  await PrismaShutdownService.create().shutdown(connection);
}

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
