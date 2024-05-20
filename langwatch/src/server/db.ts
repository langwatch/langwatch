import { PrismaClient } from "@prisma/client";

import { env } from "~/env.mjs";
import { guardEnMasse } from "../utils/dbMassDeleteProtection";
import { guardProjectId } from "../utils/dbMultiTenancyProtection";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log:
      env.NODE_ENV === "development" ? ["query", "error", "warn"] : ["error"],
  });

prisma.$use(guardEnMasse);
prisma.$use(guardProjectId);

if (env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
