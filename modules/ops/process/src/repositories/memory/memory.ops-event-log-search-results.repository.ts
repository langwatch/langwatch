import { nowInstant } from "@langwatch/time";

import {
  OPS_EVENT_LOG_SEARCH_RESULT_TTL_SECONDS,
  type OpsEventLogSearchRecord,
  OpsEventLogSearchResultsRepository,
} from "../ops-event-log-search-results.repository.ts";
import type { MemoryOpsStore } from "./memory.ops.store.ts";

/** The searches in memory, each expiring as the Redis key would. */
export class MemoryOpsEventLogSearchResultsRepository extends OpsEventLogSearchResultsRepository {
  static create({
    store,
    now = () => nowInstant().epochMilliseconds,
  }: {
    store: MemoryOpsStore;
    now?: () => number;
  }): MemoryOpsEventLogSearchResultsRepository {
    return new MemoryOpsEventLogSearchResultsRepository(store, now);
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
    record: OpsEventLogSearchRecord;
  }): Promise<void> {
    const expiresAtMs = this.now() + OPS_EVENT_LOG_SEARCH_RESULT_TTL_SECONDS * 1000;
    this.store.eventLogSearchResults.set(requestId, { record, expiresAtMs });
  }

  async findByRequestId({ requestId }: { requestId: string }): Promise<OpsEventLogSearchRecord[]> {
    const held = this.store.eventLogSearchResults.get(requestId);
    return held && held.expiresAtMs > this.now() ? [held.record] : [];
  }
}
