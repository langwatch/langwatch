import type { PrismaClient } from "@langwatch/prisma-client/generated";

import type {
  GatewayPersistenceTransaction,
  GatewayTransactionRepository,
} from "../gateway-transaction.repository.ts";

/** The one client slice a transaction needs. */
export type GatewayTransactionDatabase = Pick<PrismaClient, "$transaction">;

/** Prisma's interactive transaction, handed to services as an opaque handle. */
export class PrismaGatewayTransactionRepository implements GatewayTransactionRepository {
  static create(input: {
    database: GatewayTransactionDatabase;
  }): PrismaGatewayTransactionRepository {
    return new PrismaGatewayTransactionRepository(input.database);
  }

  private constructor(private readonly database: GatewayTransactionDatabase) {}

  run<T>(work: (transaction: GatewayPersistenceTransaction) => Promise<T>): Promise<T> {
    return this.database.$transaction((transaction) => work(transaction));
  }
}
