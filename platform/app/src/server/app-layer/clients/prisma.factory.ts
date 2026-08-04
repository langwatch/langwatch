import { PrismaClient } from "@prisma/client";

export interface PrismaFactoryOptions {
  databaseUrl: string;
  nodeEnv?: string;
}

export function createPrismaClient(opts: PrismaFactoryOptions): PrismaClient {
  return new PrismaClient({
    datasources: { db: { url: opts.databaseUrl } },
    log: opts.nodeEnv === "development" ? ["error", "warn"] : ["error"],
  });
}
