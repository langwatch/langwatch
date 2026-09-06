import { Prisma } from "@langwatch/prisma-client/generated";
import type { LangyDatabase, LangyDatabaseTransaction } from "./prisma.langy-database";

import { LangyTurnAdmissionRepository } from "../langy-turn-admission.repository";
import type { LangyTurnAdmissionClaim } from "../langy-turn-admission.repository";

const PREPARING = "preparing";
const COMMITTED = "committed";
const PREPARATION_LEASE_MS = 2 * 60 * 1000;
const COMMITTED_LEASE = new Date("9999-12-31T23:59:59.999Z");
const MAX_SERIALIZATION_ATTEMPTS = 4;
// Backstop only: a COMMITTED row has no lease-expiry escape hatch like
// PREPARING's `leaseExpiresAt`, so a worker that dies skipping every terminal
// event leaves it permanently 409ing. 10 minutes safely exceeds observed real
// turn duration (35-65s).
const COMMITTED_ABANDON_MS = 10 * 60 * 1000;

function isRetryableTransactionError(error: unknown): boolean {
  return (
    error instanceof Error && "code" in error && (error.code === "P2002" || error.code === "P2034")
  );
}

/**
 * Postgres is the authority for both logical-send replay and one-active-turn
 * admission. The event projection remains a cheap rejection hint only.
 */
export class PrismaLangyTurnAdmissionRepository extends LangyTurnAdmissionRepository {
  constructor(private readonly prisma: LangyDatabase) {
    super();
  }

  static create(database: LangyDatabase): PrismaLangyTurnAdmissionRepository {
    return new PrismaLangyTurnAdmissionRepository(database);
  }

  async claim(input: {
    projectId: string;
    userId: string;
    idempotencyKey: string;
    conversationId: string;
    turnId: string;
  }): Promise<LangyTurnAdmissionClaim> {
    for (let attempt = 0; attempt < MAX_SERIALIZATION_ATTEMPTS; attempt++) {
      try {
        return await this.prisma.$transaction(
          async (tx: LangyDatabaseTransaction) => {
            const now = new Date();
            const leaseExpiresAt = new Date(now.getTime() + PREPARATION_LEASE_MS);
            const claimToken = crypto.randomUUID();

            let receipt = await tx.langyTurnRequest.findUnique({
              where: {
                // The tenant middleware requires the discriminator at the top
                // level even when it is also inside the compound selector.
                projectId: input.projectId,
                projectId_userId_requestId: {
                  projectId: input.projectId,
                  userId: input.userId,
                  requestId: input.idempotencyKey,
                },
              },
            });

            // turnId is a hash of who+key+content; a receipt with a different
            // turnId means the key is reused for a different send — never replay.
            // (`requestId` column holds the idempotency key, historical name.)
            if (receipt && receipt.turnId !== input.turnId) {
              return { kind: "mismatch" as const };
            }

            if (receipt?.status === COMMITTED) {
              return {
                kind: "replay" as const,
                conversationId: receipt.conversationId,
                turnId: receipt.turnId,
              };
            }

            if (receipt && receipt.leaseExpiresAt > now) {
              return { kind: "pending" as const };
            }

            if (receipt) {
              const taken = await tx.langyTurnRequest.updateMany({
                where: {
                  projectId: input.projectId,
                  id: receipt.id,
                  status: PREPARING,
                  leaseExpiresAt: { lte: now },
                },
                data: { leaseOwner: claimToken, leaseExpiresAt },
              });
              if (taken.count !== 1) return { kind: "pending" as const };
              receipt = { ...receipt, leaseOwner: claimToken, leaseExpiresAt };
            } else {
              receipt = await tx.langyTurnRequest.create({
                data: {
                  projectId: input.projectId,
                  userId: input.userId,
                  requestId: input.idempotencyKey,
                  conversationId: input.conversationId,
                  turnId: input.turnId,
                  status: PREPARING,
                  leaseOwner: claimToken,
                  leaseExpiresAt,
                },
              });
            }

            // An expired receipt keeps its original identities. That is the
            // point of the receipt: a later retry may have speculatively minted
            // a fresh conversation id, but it must resume the first logical send.
            const conversationId = receipt.conversationId;
            const turnId = receipt.turnId;
            const active = await tx.langyActiveTurn.findUnique({
              where: {
                projectId: input.projectId,
                projectId_conversationId: {
                  projectId: input.projectId,
                  conversationId,
                },
              },
            });

            if (!active) {
              await tx.langyActiveTurn.create({
                data: {
                  projectId: input.projectId,
                  conversationId,
                  turnId,
                  requestId: input.idempotencyKey,
                  userId: input.userId,
                  status: PREPARING,
                  leaseOwner: claimToken,
                  leaseExpiresAt,
                },
              });
            } else if (active.turnId === turnId) {
              await tx.langyActiveTurn.update({
                where: { id: active.id, projectId: input.projectId },
                data: {
                  requestId: input.idempotencyKey,
                  userId: input.userId,
                  status: PREPARING,
                  leaseOwner: claimToken,
                  leaseExpiresAt,
                },
              });
            } else if (
              (active.status === PREPARING && active.leaseExpiresAt <= now) ||
              (active.status === COMMITTED &&
                now.getTime() - active.updatedAt.getTime() > COMMITTED_ABANDON_MS)
            ) {
              await tx.langyActiveTurn.update({
                where: { id: active.id, projectId: input.projectId },
                data: {
                  turnId,
                  requestId: input.idempotencyKey,
                  userId: input.userId,
                  status: PREPARING,
                  leaseOwner: claimToken,
                  leaseExpiresAt,
                },
              });
            } else {
              await tx.langyTurnRequest.deleteMany({
                where: {
                  projectId: input.projectId,
                  id: receipt.id,
                  status: PREPARING,
                  leaseOwner: claimToken,
                },
              });
              return { kind: "busy" as const };
            }

            return {
              kind: "claimed" as const,
              claimToken,
              conversationId,
              turnId,
            };
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        );
      } catch (error) {
        if (attempt + 1 < MAX_SERIALIZATION_ATTEMPTS && isRetryableTransactionError(error)) {
          continue;
        }
        throw error;
      }
    }
    throw new Error("unreachable: Langy turn admission retries exhausted");
  }

  async commit(input: {
    projectId: string;
    userId: string;
    idempotencyKey: string;
    conversationId: string;
    turnId: string;
    claimToken: string;
  }): Promise<void> {
    await this.prisma.$transaction(async (tx: LangyDatabaseTransaction) => {
      const receiptUpdate = await tx.langyTurnRequest.updateMany({
        where: {
          projectId: input.projectId,
          userId: input.userId,
          requestId: input.idempotencyKey,
          conversationId: input.conversationId,
          turnId: input.turnId,
          status: PREPARING,
          leaseOwner: input.claimToken,
        },
        data: { status: COMMITTED, leaseExpiresAt: COMMITTED_LEASE },
      });
      if (receiptUpdate.count !== 1) {
        const receipt = await tx.langyTurnRequest.findUnique({
          where: {
            projectId: input.projectId,
            projectId_userId_requestId: {
              projectId: input.projectId,
              userId: input.userId,
              requestId: input.idempotencyKey,
            },
          },
        });
        if (
          receipt?.conversationId !== input.conversationId ||
          receipt.turnId !== input.turnId ||
          receipt.status !== COMMITTED
        ) {
          throw new Error(`Langy turn admission receipt commit lost its claim for ${input.turnId}`);
        }
      }

      const activeUpdate = await tx.langyActiveTurn.updateMany({
        where: {
          projectId: input.projectId,
          conversationId: input.conversationId,
          turnId: input.turnId,
          status: PREPARING,
          leaseOwner: input.claimToken,
        },
        data: { status: COMMITTED, leaseExpiresAt: COMMITTED_LEASE },
      });
      if (activeUpdate.count !== 1) {
        const active = await tx.langyActiveTurn.findUnique({
          where: {
            projectId: input.projectId,
            projectId_conversationId: {
              projectId: input.projectId,
              conversationId: input.conversationId,
            },
          },
        });
        // A matching terminal event may already have released this row. A row
        // for another turn is never an idempotent success.
        if (active && (active.turnId !== input.turnId || active.status !== COMMITTED)) {
          throw new Error(`Langy active-turn commit lost its claim for ${input.turnId}`);
        }
      }
    });
  }

  async abort(input: {
    projectId: string;
    userId: string;
    idempotencyKey: string;
    conversationId: string;
    turnId: string;
    claimToken: string;
  }): Promise<void> {
    await this.prisma.$transaction(async (tx: LangyDatabaseTransaction) => {
      await tx.langyActiveTurn.deleteMany({
        where: {
          projectId: input.projectId,
          conversationId: input.conversationId,
          turnId: input.turnId,
          status: PREPARING,
          leaseOwner: input.claimToken,
        },
      });
      await tx.langyTurnRequest.deleteMany({
        where: {
          projectId: input.projectId,
          userId: input.userId,
          requestId: input.idempotencyKey,
          conversationId: input.conversationId,
          turnId: input.turnId,
          status: PREPARING,
          leaseOwner: input.claimToken,
        },
      });
    });
  }

  async confirmAccepted(input: {
    projectId: string;
    conversationId: string;
    turnId: string;
  }): Promise<void> {
    await this.prisma.$transaction(async (tx: LangyDatabaseTransaction) => {
      const active = await tx.langyActiveTurn.findUnique({
        where: {
          projectId: input.projectId,
          projectId_conversationId: {
            projectId: input.projectId,
            conversationId: input.conversationId,
          },
        },
      });
      // Legacy/pre-admission events have no row. A stale event for an older
      // turn must never promote the conversation's newer claim.
      if (!active || active.turnId !== input.turnId) return;

      await tx.langyTurnRequest.updateMany({
        where: {
          projectId: input.projectId,
          userId: active.userId,
          requestId: active.requestId,
          conversationId: input.conversationId,
          turnId: input.turnId,
          status: PREPARING,
        },
        data: { status: COMMITTED, leaseExpiresAt: COMMITTED_LEASE },
      });
      await tx.langyActiveTurn.updateMany({
        where: {
          projectId: input.projectId,
          conversationId: input.conversationId,
          turnId: input.turnId,
        },
        data: { status: COMMITTED, leaseExpiresAt: COMMITTED_LEASE },
      });
    });
  }

  async release(input: {
    projectId: string;
    conversationId: string;
    turnId?: string;
  }): Promise<void> {
    await this.prisma.langyActiveTurn.deleteMany({
      where: {
        projectId: input.projectId,
        conversationId: input.conversationId,
        ...(input.turnId ? { turnId: input.turnId } : {}),
      },
    });
  }
}
