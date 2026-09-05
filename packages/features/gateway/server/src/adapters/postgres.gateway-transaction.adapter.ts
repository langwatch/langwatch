import type { PrismaClient } from "@langwatch/prisma-client/generated";
import type { GatewayPersistenceTransaction } from "../ports/gateway-change-events.port";
import { GatewayTransactionPort } from "../ports/gateway-transaction.port";

/** The one client slice a transaction needs. */
export type GatewayTransactionDatabase = Pick<PrismaClient, "$transaction">;

/** Prisma's interactive transaction, handed to services as an opaque handle. */
export class PrismaGatewayTransactionAdapter extends GatewayTransactionPort {
  static create(input: { database: GatewayTransactionDatabase }): PrismaGatewayTransactionAdapter {
    return new PrismaGatewayTransactionAdapter(input.database);
  }

  private constructor(private readonly database: GatewayTransactionDatabase) {
    super();
  }

  run<T>(work: (transaction: GatewayPersistenceTransaction) => Promise<T>): Promise<T> {
    return this.database.$transaction((transaction) => work(transaction));
  }
}
