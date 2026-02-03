import { PrismaClient } from "@prisma/client";

import { env } from "../env.mjs";
import { guardEnMasse } from "../utils/dbMassDeleteProtection";
import { guardProjectId } from "../utils/dbMultiTenancyProtection";
import { guardOrganizationId } from "../utils/dbOrganizationIdProtection";
import { ksuidExtension } from "./prisma-ksuid-extension";

// Internal type for the extended client
type InternalExtendedPrismaClient = ReturnType<
  typeof createExtendedPrismaClient
>;

/**
 * Extended Prisma Client type that includes the KSUID extension.
 *
 * The extension automatically generates KSUID for all create operations.
 * The type is exported as PrismaClient for backward compatibility with
 * existing code that uses `PrismaClient` type annotations.
 *
 * Internally, the client includes the ksuidExtension which intercepts
 * create/createMany operations to auto-generate KSUIDs.
 */
export type ExtendedPrismaClient = PrismaClient;

const globalForPrisma = globalThis as unknown as {
  prisma: InternalExtendedPrismaClient | undefined;
};

function createExtendedPrismaClient() {
  const basePrisma = new PrismaClient({
    log: env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });

  // Apply middlewares to base client before extension
  // @ts-expect-error - tracking middleware setup
  if (!basePrisma.middlewaresSetUp) {
    basePrisma.$use(guardEnMasse);
    basePrisma.$use(guardProjectId);
    basePrisma.$use(guardOrganizationId);
    // @ts-expect-error - tracking middleware setup
    basePrisma.middlewaresSetUp = true;
  }

  // Apply KSUID extension (returns new extended client)
  return basePrisma.$extends(ksuidExtension);
}

// Cast to PrismaClient for type compatibility with existing codebase
// The KSUID extension adds behavior transparently without changing the API surface
export const prisma = (globalForPrisma.prisma ??
  createExtendedPrismaClient()) as unknown as PrismaClient;

if (env.NODE_ENV !== "production")
  globalForPrisma.prisma =
    prisma as unknown as InternalExtendedPrismaClient;
