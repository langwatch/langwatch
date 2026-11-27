// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type { CioBatchCall } from "@langwatch/enterprise-nurturing-contract";

import type { NurturingClaimRepository } from "../repositories/nurturing-claim.repository.ts";
import {
  TRACE_ACTIVE_DAY_CLAIM_SECONDS,
  type TraceActiveDayCall,
  traceActiveDayCall,
} from "../rules/nurturing-trace-active-day.rules.ts";
import { NurturingClaimReleaseService } from "./nurturing-claim-release.service.ts";

/** Calls claimed and sent per request, so a large organization never opens a burst. */
const BATCH_SIZE = 100;

type TraceActiveDayDependencies = Readonly<{
  /** Lets each member's trace_active_day of a day out once, across retries and redeliveries. */
  claims: Pick<NurturingClaimRepository, "claim" | "release">;
  /** Rejects when Customer.io did not take the calls. */
  sendBatch: (calls: CioBatchCall[]) => Promise<void>;
}>;

/**
 * Sends each member's trace_active_day for each traced day, claimed per member and day before it
 * is sent, so a retry, a redelivery or the next sync never sends it twice.
 */
export class NurturingTraceActiveDayService {
  static create(dependencies: TraceActiveDayDependencies): NurturingTraceActiveDayService {
    return new NurturingTraceActiveDayService(dependencies);
  }

  private constructor(private readonly dependencies: TraceActiveDayDependencies) {}

  /**
   * Answers how many it sent. A failed claim or a refused batch gives that whole batch's claims back and
   * throws, so the caller's retry sends them; batches sent before it keep theirs.
   */
  async send({
    userIds,
    days,
    organizationCreatedAt,
  }: Readonly<{
    userIds: readonly string[];
    days: readonly string[];
    organizationCreatedAt: number;
  }>): Promise<number> {
    const due = userIds.flatMap((userId) =>
      days.map((day) => traceActiveDayCall({ userId, day, organizationCreatedAt })),
    );
    let sent = 0;
    for (let start = 0; start < due.length; start += BATCH_SIZE) {
      sent += await this.sendBatchOf(due.slice(start, start + BATCH_SIZE));
    }
    return sent;
  }

  private async sendBatchOf(batch: readonly TraceActiveDayCall[]): Promise<number> {
    const { claims, sendBatch } = this.dependencies;
    const results = await Promise.allSettled(
      batch.map(({ claimKey }) => claims.claim(claimKey, TRACE_ACTIVE_DAY_CLAIM_SECONDS)),
    );
    const claimed = batch.filter((_, index) => {
      const result = results[index];
      return result?.status === "fulfilled" && result.value;
    });
    const releasing = (error: unknown) =>
      NurturingClaimReleaseService.create(claims).rethrowAfterReleasing({
        error,
        // Ours (claimed) plus rejected ones, which a timeout may still have saved. Never a key whose
        // claim returned false: another sync holds it and has sent, or is sending, that event, and
        // releasing it (a plain delete) would let a retry send it twice.
        keys: batch
          .filter((_, index) => {
            const result = results[index];
            return result?.status === "rejected" || result?.value === true;
          })
          .map(({ claimKey }) => claimKey),
      });
    const failed = results.find(
      (result): result is PromiseRejectedResult => result.status === "rejected",
    );
    if (failed) return releasing(failed.reason);
    try {
      if (claimed.length > 0) await sendBatch(claimed.map(({ call }) => call));
    } catch (error) {
      return releasing(error);
    }
    return claimed.length;
  }
}
