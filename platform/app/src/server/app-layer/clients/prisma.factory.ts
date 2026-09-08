import { PrismaClient } from "~/generated/prisma/client";
import { createPrismaPgAdapter } from "~/server/prismaPgAdapter";

export interface PrismaFactoryOptions {
  databaseUrl: string;
  nodeEnv?: string;
}

export function createPrismaClient(opts: PrismaFactoryOptions): PrismaClient {
  return new PrismaClient({
    adapter: createPrismaPgAdapter(opts.databaseUrl),
    log: opts.nodeEnv === "development" ? ["error", "warn"] : ["error"],
  });
}
