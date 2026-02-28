import { PrismaClient } from "@prisma/client";

import { env } from "../env.mjs";
import { guardEnMasse } from "../utils/dbMassDeleteProtection";
import { guardProjectId } from "../utils/dbMultiTenancyProtection";
import { guardOrganizationId } from "../utils/dbOrganizationIdProtection";
import { createLogger } from "../utils/logger/server";

const logger = createLogger("langwatch:prisma");

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log:
      env.NODE_ENV === "development"
        ? [
            { emit: "event", level: "error" },
            { emit: "event", level: "warn" },
          ]
        : [{ emit: "event", level: "error" }],
  });

// Route Prisma logs through the custom logger
prisma.$on("error" as never, (e: { message: string; target?: string }) => {
  logger.error({ target: e.target }, e.message);
});
prisma.$on("warn" as never, (e: { message: string; target?: string }) => {
  logger.warn({ target: e.target }, e.message);
});

//@ts-ignore
if (!prisma.middlewaresSetUp) {
  prisma.$use(guardEnMasse);
  prisma.$use(guardProjectId);
  prisma.$use(guardOrganizationId);
  //@ts-ignore
  prisma.middlewaresSetUp = true;
}

if (env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
