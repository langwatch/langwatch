import type {
  PendingSsoSetupCandidate,
  PendingSsoSetupRepository,
} from "../pending-sso-setup.repository.ts";

/** In-process twin of the `User.pendingSsoSetup` rows. */
export class MemoryPendingSsoSetupRepository implements PendingSsoSetupRepository {
  readonly pending = new Map<string, PendingSsoSetupCandidate>();

  private constructor(candidates: readonly PendingSsoSetupCandidate[]) {
    for (const candidate of candidates) this.pending.set(candidate.id, candidate);
  }

  static create({
    candidates = [],
  }: { candidates?: readonly PendingSsoSetupCandidate[] } = {}): MemoryPendingSsoSetupRepository {
    return new MemoryPendingSsoSetupRepository(candidates);
  }

  async findPendingPage({
    afterId,
    take,
  }: {
    afterId: string | undefined;
    take: number;
  }): Promise<PendingSsoSetupCandidate[]> {
    return [...this.pending.values()]
      .filter((candidate) => afterId === undefined || candidate.id > afterId)
      .toSorted((a, b) => (a.id < b.id ? -1 : 1))
      .slice(0, take);
  }

  async clearPendingSsoSetup({ userId }: { userId: string }): Promise<void> {
    this.pending.delete(userId);
  }
}
