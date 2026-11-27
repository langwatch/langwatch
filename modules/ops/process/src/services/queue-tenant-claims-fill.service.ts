import { setTimeout as sleep } from "node:timers/promises";

import type { QueueRepository } from "../repositories/queue.repository.ts";

/** SCAN pages per saved slice of the claimed-groups backfill: ~100k keys between checkpoints. */
const TENANT_CLAIMS_FILL_SCAN_CALLS = 200;

/** Rest between slices, so live queue traffic gets Redis between the walk's bursts (ADR-092). */
const TENANT_CLAIMS_FILL_PAUSE_MS = 1_000;

/** Waits between slices; resolves early, without throwing, when the signal aborts. */
export type SlicePause = (input: { ms: number; signal: AbortSignal }) => Promise<void>;

const pauseUnlessAborted: SlicePause = ({ ms, signal }) =>
  sleep(ms, undefined, { signal }).catch(() => undefined);

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
 * in slices of `TENANT_CLAIMS_FILL_SCAN_CALLS`, each cursor saved, then a pause before the next.
 */
export class QueueTenantClaimsFillService {
  private constructor(
    private readonly repository: Pick<QueueRepository, "fillTenantClaims">,
    private readonly pause: SlicePause,
  ) {}

  static create({
    repository,
    pause = pauseUnlessAborted,
  }: {
    repository: Pick<QueueRepository, "fillTenantClaims">;
    pause?: SlicePause;
  }): QueueTenantClaimsFillService {
    return new QueueTenantClaimsFillService(repository, pause);
  }

  async fill({
    resumeCursor,
    signal,
    onSlice,
  }: TenantClaimsFillInput): Promise<TenantClaimsFillOutcome> {
    let cursor = resumeCursor;
    let listed = 0;
    let slices = 0;
    do {
      if (slices > 0) await this.pause({ ms: TENANT_CLAIMS_FILL_PAUSE_MS, signal });
      if (signal.aborted) return { listed, finished: false };
      const slice = await this.repository.fillTenantClaims({
        cursor,
        maxScanCalls: TENANT_CLAIMS_FILL_SCAN_CALLS,
      });
      cursor = slice.cursor;
      listed += slice.listed;
      slices += 1;
      await onSlice({ cursor, listed });
    } while (cursor !== "0");
    return { listed, finished: true };
  }
}
