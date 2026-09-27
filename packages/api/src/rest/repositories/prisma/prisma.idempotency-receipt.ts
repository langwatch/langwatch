/**
 * The idempotency receipt table as Prisma serves it: the one place its moments are `Date`s. The
 * protocol in ../../idempotency.ts works in instants and converts at each call.
 */
export type IdempotencyReceiptCreateInput = {
  scopeId: string;
  key: string;
  claimId: string;
  requestFingerprint: string;
  heartbeatAt: Date;
  expiresAt: Date;
};

/**
 * Stated structurally, not imported from generated Prisma types — this
 * package is the API framework and may not depend on a schema.
 */
export type IdempotencyReceiptRecord = {
  id: string;
  claimId: string;
  requestFingerprint: string;
  heartbeatAt: Date;
  expiresAt: Date;
  responseStatus: number | null;
  responseBody: string | null;
};

/**
 * Minimal durable receipt store used by the idempotency protocol. The fenced
 * writes are SQL (see {@link takeOverClaim}), so a transaction client fits too.
 */
export interface IdempotencyReceiptPersistence {
  $executeRaw(query: TemplateStringsArray, ...values: unknown[]): PromiseLike<number>;
  readonly idempotencyReceipt: {
    create(input: {
      data: IdempotencyReceiptCreateInput;
      select: { id: true };
    }): Promise<{ id: string }>;
    findUnique(input: {
      where: { scopeId_key: { scopeId: string; key: string } };
    }): Promise<IdempotencyReceiptRecord | null>;
    deleteMany(input: { where: { id: string; claimId?: string } }): Promise<{ count: number }>;
  };
}
