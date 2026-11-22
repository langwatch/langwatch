import type { Prisma, PrismaClient } from "@langwatch/prisma-client/generated";

/** Generated Prisma types are confined to this strict repository boundary. */
export interface LangyDatabaseTransaction {
  readonly langyTurnRequest: PrismaClient["langyTurnRequest"];
  readonly langyActiveTurn: PrismaClient["langyActiveTurn"];
}

export interface LangyDatabase {
  readonly project: PrismaClient["project"];
  readonly apiKey: PrismaClient["apiKey"];
  readonly virtualKey: PrismaClient["virtualKey"];
  readonly langyConversationProjection: PrismaClient["langyConversationProjection"];
  readonly langyConversationTurnProjection: PrismaClient["langyConversationTurnProjection"];
  readonly langyPullRequest: PrismaClient["langyPullRequest"];
  readonly langyMessageProjection: PrismaClient["langyMessageProjection"];
  readonly langyTurnRequest: PrismaClient["langyTurnRequest"];
  readonly langyActiveTurn: PrismaClient["langyActiveTurn"];
  readonly $queryRaw: PrismaClient["$queryRaw"];
  $transaction<T>(
    operation: (transaction: LangyDatabaseTransaction) => Promise<T>,
    options?: { isolationLevel?: Prisma.TransactionIsolationLevel },
  ): Promise<T>;
}
