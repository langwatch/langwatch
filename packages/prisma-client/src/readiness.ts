import type { PrismaConnection } from "./connection";

export interface PrismaReadinessOptions {
  connection: PrismaConnection;
}

/** A guarded readiness probe; callers decide whether a failure stops boot. */
export class PrismaReadinessService {
  private constructor() {}

  static create(): PrismaReadinessService {
    return new PrismaReadinessService();
  }

  async check(options: PrismaReadinessOptions): Promise<void> {
    await options.connection.client.$queryRawUnsafe(
      "-- @tenancy: prisma readiness probe\nSELECT 1 AS ready",
    );
  }
}
