import {
  type CloudLatestRelease,
  CloudLatestReleaseRepository,
} from "../cloud-latest-release.repository.ts";
import type { MemoryOpsStore } from "./memory.ops.store.ts";

/** The held latest release in memory, replaced and forgotten as the Redis key is. */
export class MemoryCloudLatestReleaseRepository extends CloudLatestReleaseRepository {
  static create({ store }: { store: MemoryOpsStore }): MemoryCloudLatestReleaseRepository {
    return new MemoryCloudLatestReleaseRepository(store);
  }

  private constructor(private readonly store: MemoryOpsStore) {
    super();
  }

  async save(latest: CloudLatestRelease | null): Promise<void> {
    this.store.cloudLatestRelease.splice(0, this.store.cloudLatestRelease.length);
    if (latest) this.store.cloudLatestRelease.push(latest);
  }

  async find(): Promise<CloudLatestRelease[]> {
    return [...this.store.cloudLatestRelease];
  }
}
