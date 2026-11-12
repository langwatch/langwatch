import { LangyGithubPrCountRepository } from "../langy-github-pr-count.repository.ts";

/** The day buckets in process memory: the same sets, no expiry (a test outlives no day). */
export class LangyGithubPrCountMemoryRepository extends LangyGithubPrCountRepository {
  private readonly buckets = new Map<string, Set<string>>();

  static create(): LangyGithubPrCountMemoryRepository {
    return new LangyGithubPrCountMemoryRepository();
  }

  private constructor() {
    super();
  }

  count(key: string): Promise<number> {
    return Promise.resolve(this.buckets.get(key)?.size ?? 0);
  }

  add({ key, pullRequests }: { key: string; pullRequests: readonly string[] }): Promise<void> {
    const bucket = this.buckets.get(key) ?? new Set<string>();
    for (const pullRequest of pullRequests) bucket.add(pullRequest);
    this.buckets.set(key, bucket);
    return Promise.resolve();
  }
}
