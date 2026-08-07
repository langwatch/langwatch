import { PrismaClient } from "~/generated/prisma/client";
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
    adapter: createPrismaPgAdapter(env.DATABASE_URL),
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

export const prisma = globalForPrisma.prisma ?? createGuardedPrismaClient();

if (env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
