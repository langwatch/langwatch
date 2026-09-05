import type { PrismaClient } from "@langwatch/prisma-client/generated";
import type { AuthDirectoryPort } from "../ports/auth-directory.port";
import { PrismaAuthDirectoryRepository } from "../repositories/prisma/prisma.auth-directory.repository";

/** The Postgres seam a process composes the auth transports' row reads from. */
export class PostgresAuthDirectoryAdapter {
  private constructor() {}

  static create({ database }: { database: PrismaClient }): AuthDirectoryPort {
    return PrismaAuthDirectoryRepository.create(database);
  }
}
