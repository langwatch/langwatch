/**
 * ErrorStreak counts consecutive visits that were harness or stack errors, in the order the
 * visits complete. A visit that worked ends the streak; a limit of 0 never trips.
 */
export class ErrorStreak {
  private run = 0;
  private readonly causes = new Map<string, number>();
  private reason: string | undefined;

  constructor(private readonly limit: number) {}

  /** stopped is the line after "fuzz ui: " once the streak has tripped. */
  get stopped(): string | undefined {
    return this.reason;
  }

  /** record files one completed visit: an empty cause is a visit that worked. */
  record(cause: string): void {
    if (cause === "") {
      this.run = 0;
      this.causes.clear();
      return;
    }
    if (this.limit <= 0 || this.reason !== undefined) return;
    this.run += 1;
    this.causes.set(cause, (this.causes.get(cause) ?? 0) + 1);
    if (this.run >= this.limit) this.reason = this.describe();
  }

  private describe(): string {
    const [[cause, times] = ["", 0]] = [...this.causes].toSorted(
      ([nameA, countA], [nameB, countB]) => countB - countA || nameA.localeCompare(nameB),
    );
    return `stopping: ${this.run} consecutive errors, most common cause: ${cause} (x${times})`;
  }
}
