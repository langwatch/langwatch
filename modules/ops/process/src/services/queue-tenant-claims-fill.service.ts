import type { QueueRepository } from "../repositories/queue.repository.ts";

/** SCAN pages per saved slice of the claimed-groups backfill: ~100k keys between checkpoints. */
const TENANT_CLAIMS_FILL_SCAN_CALLS = 200;

/** Where the claimed-groups backfill resumes, and where each saved slice reports to. */
export interface TenantClaimsFillInput {
  resumeCursor: string;
  signal: AbortSignal;
  onSlice: (progress: { cursor: string; listed: number }) => Promise<void>;
}

/** Groups listed by this run; `finished` false when it stopped on its signal. */
export type TenantClaimsFillOutcome = {
  listed: number;
  finished: boolean;
};

/**
 * Lists claims made before the claimed-groups index existed (ADR-092): one walk of the keyspace
 * in slices of `TENANT_CLAIMS_FILL_SCAN_CALLS`, each cursor saved before the next.
 */
export class QueueTenantClaimsFillService {
  private constructor(private readonly repository: Pick<QueueRepository, "fillTenantClaims">) {}

  static create({
    repository,
  }: {
    repository: Pick<QueueRepository, "fillTenantClaims">;
  }): QueueTenantClaimsFillService {
    return new QueueTenantClaimsFillService(repository);
  }

  async fill({
    resumeCursor,
    signal,
    onSlice,
  }: TenantClaimsFillInput): Promise<TenantClaimsFillOutcome> {
    let cursor = resumeCursor;
    let listed = 0;
    do {
      if (signal.aborted) return { listed, finished: false };
      const slice = await this.repository.fillTenantClaims({
        cursor,
        maxScanCalls: TENANT_CLAIMS_FILL_SCAN_CALLS,
      });
      cursor = slice.cursor;
      listed += slice.listed;
      await onSlice({ cursor, listed });
    } while (cursor !== "0");
    return { listed, finished: true };
  }
}
