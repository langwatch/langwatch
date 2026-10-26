import { type Authorization, ownProjectIdReadBy } from "@langwatch/authorization";
import type { ModelProviderApi } from "@langwatch/model-provider-contract";

import type { TraceBraidReadsRepository } from "../../../repositories/trace-braid-reads.repository.ts";
import { readsBraidedSpans } from "../../../rules/braided-span-owner.rules.ts";
import {
  type BraidedOwnerTotals,
  braidedOwnerTotalsOf,
} from "../../../rules/braided-trace-totals.rules.ts";

/** The trace header's braided totals, read through the reader's own braided proof (ADR-185 §5). */
export class TraceBraidedTotalsService {
  static create({
    reads,
    prices,
  }: {
    reads: TraceBraidReadsRepository;
    prices: Pick<ModelProviderApi, "estimateCost"> | null;
  }): TraceBraidedTotalsService {
    return new TraceBraidedTotalsService(reads, prices);
  }

  readonly #reads: TraceBraidReadsRepository;
  readonly #prices: Pick<ModelProviderApi, "estimateCost"> | null;

  private constructor(
    reads: TraceBraidReadsRepository,
    prices: Pick<ModelProviderApi, "estimateCost"> | null,
  ) {
    this.#reads = reads;
    this.#prices = prices;
  }

  /** Each owner's spans in one trace the condition lets through; none, unread, without braids. */
  async ownerTotals({
    authorization,
    traceId,
    occurredAtMs,
  }: {
    authorization: Authorization;
    traceId: string;
    occurredAtMs?: number | undefined;
  }): Promise<BraidedOwnerTotals[]> {
    if (!readsBraidedSpans(authorization)) return [];
    const groups = await this.#reads.sumSpansInTrace({ authorization, traceId, occurredAtMs });
    const prices = this.#prices;
    return braidedOwnerTotalsOf({
      groups,
      readerProjectId: ownProjectIdReadBy(authorization),
      priceOf: (costInput) => prices?.estimateCost(costInput) ?? 0,
    });
  }
}
