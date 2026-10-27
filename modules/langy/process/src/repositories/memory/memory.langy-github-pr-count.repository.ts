import { LangyGithubPrCountRepository } from "../langy-github-pr-count.repository.ts";

/** The counter in process memory: the same counts, no expiry (a test outlives no day). */
export class LangyGithubPrCountMemoryRepository extends LangyGithubPrCountRepository {
  private readonly counts = new Map<string, number>();

  static create(): LangyGithubPrCountMemoryRepository {
    return new LangyGithubPrCountMemoryRepository();
  }

  private constructor() {
    super();
  }

  count(key: string): Promise<number> {
    return Promise.resolve(this.counts.get(key) ?? 0);
  }

  add({ key, amount }: { key: string; amount: number }): Promise<number> {
    const next = (this.counts.get(key) ?? 0) + amount;
    this.counts.set(key, next);
    return Promise.resolve(next);
  }

  takeBack(key: string): Promise<void> {
    this.counts.set(key, (this.counts.get(key) ?? 0) - 1);
    return Promise.resolve();
  }

  release(key: string): Promise<void> {
    this.counts.set(key, Math.max(0, (this.counts.get(key) ?? 0) - 1));
    return Promise.resolve();
  }
}
