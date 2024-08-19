import { PrismaClient } from "@prisma/client";

import { env } from "../env.mjs";
import { guardEnMasse } from "../utils/dbMassDeleteProtection";
import { guardProjectId } from "../utils/dbMultiTenancyProtection";
import { guardOrganizationId } from "../utils/dbOrganizationIdProtection";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });

prisma.$use(guardEnMasse);
prisma.$use(guardProjectId);
prisma.$use(guardOrganizationId);

if (env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
