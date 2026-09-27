import { generate } from "@langwatch/ksuid";
import { Prisma } from "@langwatch/prisma-client/generated";

import { LangyTurnAdmissionRepository } from "../langy-turn-admission.repository.ts";
import type { LangyTurnAdmissionClaim } from "../langy-turn-admission.repository.ts";
import type { LangyDatabase, LangyDatabaseTransaction } from "./langy-database.mapper.ts";

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

type ClaimInput = {
  projectId: string;
  userId: string;
  idempotencyKey: string;
  conversationId: string;
  turnId: string;
};
type Lease = { now: Date; leaseExpiresAt: Date; claimToken: string };
type ReceiptRow = Awaited<ReturnType<LangyDatabaseTransaction["langyTurnRequest"]["create"]>>;
type ActiveRow = Awaited<ReturnType<LangyDatabaseTransaction["langyActiveTurn"]["create"]>>;

/**
 * One claim, inside its serializable transaction: the logical send's receipt first, then the
 * conversation's one active turn. A claim that cannot take the turn gives its receipt back.
 */
async function claimIn(
  tx: LangyDatabaseTransaction,
  input: ClaimInput,
): Promise<LangyTurnAdmissionClaim> {
  const now = new Date();
  const lease = {
    now,
    leaseExpiresAt: new Date(now.getTime() + PREPARATION_LEASE_MS),
    claimToken: generate("langy").toString(),
  };
  const step = await leaseReceipt({ tx, input, lease });
  if ("answer" in step) return step.answer;
  const { conversationId, turnId, id } = step.receipt;
  if (await leaseActiveTurn({ tx, input, lease, conversationId, turnId })) {
    return { kind: "claimed", claimToken: lease.claimToken, conversationId, turnId };
  }
  await tx.langyTurnRequest.deleteMany({
    where: { projectId: input.projectId, id, status: PREPARING, leaseOwner: lease.claimToken },
  });
  return { kind: "busy" };
}

/**
 * What an existing receipt already answers. turnId is a hash of who+key+content, so a different
 * turnId means the key was reused for a different send — never replay. (`requestId` holds the
 * idempotency key, a historical name.)
 */
function receiptAnswers({
  receipt,
  input,
  now,
}: {
  receipt: ReceiptRow;
  input: ClaimInput;
  now: Date;
}): LangyTurnAdmissionClaim[] {
  if (receipt.turnId !== input.turnId) return [{ kind: "mismatch" }];
  if (receipt.status === COMMITTED) {
    return [{ kind: "replay", conversationId: receipt.conversationId, turnId: receipt.turnId }];
  }
  if (receipt.leaseExpiresAt > now) return [{ kind: "pending" }];
  return [];
}

/**
 * The logical send's receipt, leased to this claim — created, or taken over once its lease
 * expired. An expired receipt keeps its original identities: a retry that minted a fresh
 * conversation id must still resume the first logical send.
 */
async function leaseReceipt({
  tx,
  input,
  lease,
}: {
  tx: LangyDatabaseTransaction;
  input: ClaimInput;
  lease: Lease;
}): Promise<{ answer: LangyTurnAdmissionClaim } | { receipt: ReceiptRow }> {
  const existing = await tx.langyTurnRequest.findUnique({
    where: {
      // The tenant middleware requires the discriminator at the top level even
      // when it is also inside the compound selector.
      projectId: input.projectId,
      projectId_userId_requestId: {
        projectId: input.projectId,
        userId: input.userId,
        requestId: input.idempotencyKey,
      },
    },
  });
  if (!existing) {
    const receipt = await tx.langyTurnRequest.create({
      data: {
        projectId: input.projectId,
        userId: input.userId,
        requestId: input.idempotencyKey,
        conversationId: input.conversationId,
        turnId: input.turnId,
        status: PREPARING,
        leaseOwner: lease.claimToken,
        leaseExpiresAt: lease.leaseExpiresAt,
      },
    });
    return { receipt };
  }
  const [answer] = receiptAnswers({ receipt: existing, input, now: lease.now });
  if (answer) return { answer };
  const taken = await tx.langyTurnRequest.updateMany({
    where: {
      projectId: input.projectId,
      id: existing.id,
      status: PREPARING,
      leaseExpiresAt: { lte: lease.now },
    },
    data: { leaseOwner: lease.claimToken, leaseExpiresAt: lease.leaseExpiresAt },
  });
  if (taken.count !== 1) return { answer: { kind: "pending" } };
  return {
    receipt: { ...existing, leaseOwner: lease.claimToken, leaseExpiresAt: lease.leaseExpiresAt },
  };
}

/** A turn another send holds may be taken once its preparation lapsed or its commit went quiet. */
function isAbandoned(active: ActiveRow, now: Date): boolean {
  if (active.status === PREPARING) return active.leaseExpiresAt <= now;
  if (active.status !== COMMITTED) return false;
  return now.getTime() - active.updatedAt.getTime() > COMMITTED_ABANDON_MS;
}

/** Takes the conversation's one active turn for this send, or reports it is held by another. */
async function leaseActiveTurn({
  tx,
  input,
  lease,
  conversationId,
  turnId,
}: {
  tx: LangyDatabaseTransaction;
  input: ClaimInput;
  lease: Lease;
  conversationId: string;
  turnId: string;
}): Promise<boolean> {
  const active = await tx.langyActiveTurn.findUnique({
    where: {
      projectId: input.projectId,
      projectId_conversationId: { projectId: input.projectId, conversationId },
    },
  });
  const held = {
    requestId: input.idempotencyKey,
    userId: input.userId,
    status: PREPARING,
    leaseOwner: lease.claimToken,
    leaseExpiresAt: lease.leaseExpiresAt,
  };
  if (!active) {
    await tx.langyActiveTurn.create({
      data: { projectId: input.projectId, conversationId, turnId, ...held },
    });
    return true;
  }
  const where = { id: active.id, projectId: input.projectId };
  if (active.turnId === turnId) {
    await tx.langyActiveTurn.update({ where, data: held });
    return true;
  }
  if (!isAbandoned(active, lease.now)) return false;
  await tx.langyActiveTurn.update({ where, data: { turnId, ...held } });
  return true;
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

  async claim(input: ClaimInput): Promise<LangyTurnAdmissionClaim> {
    for (let attempt = 0; attempt < MAX_SERIALIZATION_ATTEMPTS; attempt++) {
      try {
        return await this.prisma.$transaction(
          (tx: LangyDatabaseTransaction) => claimIn(tx, input),
          {
            isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
          },
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
