import type { Prisma } from "./generated/client";

export interface PrismaConfigurationInput {
  /** A validated PostgreSQL URL supplied by the composition root. */
  databaseUrl: string;
  /** Prisma log levels are explicit process configuration, never inferred. */
  log?: Prisma.LogLevel[] | undefined;
}

export interface PrismaConfiguration {
  databaseUrl: string;
  log: Prisma.LogLevel[];
}

/** Pure, environment-independent Prisma configuration resolution. */
export class PrismaConfigService {
  private constructor() {}

  static create(): PrismaConfigService {
    return new PrismaConfigService();
  }

  resolve(input: PrismaConfigurationInput): PrismaConfiguration {
    return {
      databaseUrl: input.databaseUrl,
      log: [...(input.log ?? ["error"])],
    };
  }
}
