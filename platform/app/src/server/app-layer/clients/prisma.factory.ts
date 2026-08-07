import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "~/generated/prisma/client";

export interface PrismaFactoryOptions {
  databaseUrl: string;
  nodeEnv?: string;
}

export function createPrismaClient(opts: PrismaFactoryOptions): PrismaClient {
  return new PrismaClient({
    adapter: new PrismaPg({ connectionString: opts.databaseUrl }),
    log: opts.nodeEnv === "development" ? ["error", "warn"] : ["error"],
  });
}
