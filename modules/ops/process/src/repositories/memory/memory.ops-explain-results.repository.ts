import { nowInstant } from "@langwatch/time";

import {
  OPS_EXPLAIN_RESULT_TTL_SECONDS,
  type OpsExplainRecord,
  OpsExplainResultsRepository,
} from "../ops-explain-results.repository.ts";
import type { MemoryOpsStore } from "./memory.ops.store.ts";

/** The EXPLAIN requests in memory, each expiring as the Redis key would. */
export class MemoryOpsExplainResultsRepository extends OpsExplainResultsRepository {
  static create({
    store,
    now = () => nowInstant().epochMilliseconds,
  }: {
    store: MemoryOpsStore;
    now?: () => number;
  }): MemoryOpsExplainResultsRepository {
    return new MemoryOpsExplainResultsRepository(store, now);
  }

  private constructor(
    private readonly store: MemoryOpsStore,
    private readonly now: () => number,
  ) {
    super();
  }

  async save({
    requestId,
    record,
  }: {
    requestId: string;
    record: OpsExplainRecord;
  }): Promise<void> {
    const expiresAtMs = this.now() + OPS_EXPLAIN_RESULT_TTL_SECONDS * 1000;
    this.store.explainResults.set(requestId, { record, expiresAtMs });
  }

  async findByRequestId({ requestId }: { requestId: string }): Promise<OpsExplainRecord[]> {
    const held = this.store.explainResults.get(requestId);
    return held && held.expiresAtMs > this.now() ? [held.record] : [];
  }
}
