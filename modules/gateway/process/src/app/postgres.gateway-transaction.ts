import type { ProcessMembers } from "@langwatch/process-stores/members";

import { type GatewayPersistenceTransaction, type GatewayTransaction } from "./gateway.members.ts";

/** The one client slice a transaction needs. */
export type GatewayTransactionDatabase = Pick<ProcessMembers["prisma"], "$transaction">;

/** Prisma's interactive transaction, handed to services as an opaque handle. */
export class PrismaGatewayTransactionAdapter implements GatewayTransaction {
  static create(input: { database: GatewayTransactionDatabase }): PrismaGatewayTransactionAdapter {
    return new PrismaGatewayTransactionAdapter(input.database);
  }

  private constructor(private readonly database: GatewayTransactionDatabase) {}

  run<T>(work: (transaction: GatewayPersistenceTransaction) => Promise<T>): Promise<T> {
    return this.database.$transaction((transaction) => work(transaction));
  }
}
