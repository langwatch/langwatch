import type { PrismaConnection } from "./connection";

/** Idempotent shutdown of the Prisma client followed by its explicit pg pool. */
export class PrismaShutdownService {
  private constructor() {}

  static create(): PrismaShutdownService {
    return new PrismaShutdownService();
  }

  shutdown(connection: PrismaConnection): Promise<void> {
    return connection.closeOnce();
  }
}
