import type { SelfHostedNotice } from "@langwatch/ops-contract";

import { CloudNoticeRepository } from "../cloud-notice.repository.ts";
import type { MemoryOpsStore } from "./memory.ops.store.ts";

/** The held notices in memory, replaced and forgotten as the Redis key is. */
export class MemoryCloudNoticeRepository extends CloudNoticeRepository {
  static create({ store }: { store: MemoryOpsStore }): MemoryCloudNoticeRepository {
    return new MemoryCloudNoticeRepository(store);
  }

  private constructor(private readonly store: MemoryOpsStore) {
    super();
  }

  async save(notices: readonly SelfHostedNotice[]): Promise<void> {
    this.store.cloudNotices.splice(0, this.store.cloudNotices.length, ...notices);
  }

  async find(): Promise<SelfHostedNotice[]> {
    return [...this.store.cloudNotices];
  }
}
