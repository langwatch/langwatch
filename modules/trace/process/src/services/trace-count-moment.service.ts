import type { TraceUsageCountRepository } from "../repositories/trace-usage-count.repository.ts";

/**
 * The moment the upgrade's trace count runs up to, as the new-trace subscriber reads it. Once
 * stored it never changes, so a found moment is kept for the process's life; a missing one is
 * read again every time, so the first trace at or after it sees it.
 */
export class TraceCountMomentService {
  #found: number | undefined;

  private constructor(
    private readonly moments: Pick<
      TraceUsageCountRepository,
      "findCountMoment" | "recordCountMoment"
    >,
  ) {}

  static create({
    moments,
  }: {
    moments: Pick<TraceUsageCountRepository, "findCountMoment" | "recordCountMoment">;
  }): TraceCountMomentService {
    return new TraceCountMomentService(moments);
  }

  async find(): Promise<number | undefined> {
    if (this.#found !== undefined) return this.#found;
    const [stored] = await this.moments.findCountMoment();
    this.#found = stored;
    return stored;
  }

  /** Stores the moment unless one already is; answers the one in force. */
  async ensure({ countedUntil }: { countedUntil: number }): Promise<number> {
    const stored = await this.find();
    if (stored !== undefined) return stored;
    await this.moments.recordCountMoment({ countedUntil });
    this.#found = countedUntil;
    return countedUntil;
  }
}
