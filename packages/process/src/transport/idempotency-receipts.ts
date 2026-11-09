import type {
  IdempotencyReceiptFence,
  IdempotencyReceiptPersistence,
  IdempotencyReceiptUpdate,
} from "@langwatch/api/rest";
import { skipTenantCheck } from "@langwatch/prisma-client";
import { Prisma, type PrismaClient } from "@langwatch/prisma-client/generated";

/** A Prisma client or an open transaction: both carry the delegate and raw statements. */
export type IdempotencyReceiptClient = Pick<
  PrismaClient | Prisma.TransactionClient,
  "idempotencyReceipt" | "$executeRaw"
>;

const COLUMNS = {
  claimId: '"claimId"',
  heartbeatAt: '"heartbeatAt"',
  expiresAt: '"expiresAt"',
  responseStatus: '"responseStatus"',
  responseBody: '"responseBody"',
} as const satisfies Record<keyof IdempotencyReceiptUpdate, string>;

function setClause(data: IdempotencyReceiptUpdate): Prisma.Sql {
  const assignments = (Object.keys(COLUMNS) as (keyof IdempotencyReceiptUpdate)[])
    .filter((column) => data[column] !== undefined)
    .map((column) => Prisma.sql`${Prisma.raw(COLUMNS[column])} = ${data[column]}`);
  if (assignments.length === 0) throw new Error("A fenced receipt write must set a column");
  return Prisma.join(assignments, ", ");
}

/**
 * The fenced write as one UPDATE with its conditions against the table. Prisma's `updateMany`
 * compiles to `WHERE id IN (SELECT ...)`, and a write parked on the row lock re-checks only
 * that subquery on its old snapshot, so two racing takeovers would both win.
 * @see specs/ai-gateway/idempotency.feature
 */
async function fencedUpdate({
  client,
  where,
  data,
}: {
  client: IdempotencyReceiptClient;
  where: IdempotencyReceiptFence;
  data: IdempotencyReceiptUpdate;
}): Promise<{ count: number }> {
  const pending =
    where.responseStatus === null ? Prisma.sql`AND "responseStatus" IS NULL` : Prisma.empty;
  const count = await client.$executeRaw`
    ${skipTenantCheck({
      // A receipt is addressed by its own id, resolved from the caller's (scopeId, key).
      SKIP_TENANT_CHECK: true,
    })}
    UPDATE "IdempotencyReceipt"
       SET ${setClause(data)}
     WHERE "id" = ${where.id}
       AND "claimId" = ${where.claimId}
       ${pending}
  `;
  return { count };
}

/** The receipt store the idempotency protocol runs on, its fenced writes held under concurrency. */
export function idempotencyReceiptsOn(
  client: IdempotencyReceiptClient,
): IdempotencyReceiptPersistence {
  return {
    idempotencyReceipt: {
      create: (input) => client.idempotencyReceipt.create(input),
      findUnique: (input) => client.idempotencyReceipt.findUnique(input),
      deleteMany: (input) => client.idempotencyReceipt.deleteMany(input),
      updateMany: ({ where, data }) => fencedUpdate({ client, where, data }),
    },
  };
}
