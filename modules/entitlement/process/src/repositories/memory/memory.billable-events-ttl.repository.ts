import {
  BillableEventsTtlRepository,
  type TtlMutation,
} from "../billable-events-ttl.repository.ts";

/** In-memory `system.mutations` for the TTL materialisation: seeded by a test. */
export class MemoryBillableEventsTtlRepository extends BillableEventsTtlRepository {
  readonly #mutations: TtlMutation[] = [];
  #started = 0;
  #nextStartError: Error | null = null;

  static create(): MemoryBillableEventsTtlRepository {
    return new MemoryBillableEventsTtlRepository();
  }

  private constructor() {
    super();
  }

  /** Records a mutation as the newest, or replaces the one with the same id. */
  record(mutation: TtlMutation): void {
    const at = this.#mutations.findIndex((each) => each.mutationId === mutation.mutationId);
    if (at >= 0) this.#mutations.splice(at, 1);
    this.#mutations.unshift(mutation);
  }

  /** How many times the materialisation was started. */
  started(): number {
    return this.#started;
  }

  async findTtlMutations(): Promise<TtlMutation[]> {
    return [...this.#mutations];
  }

  /** Makes the next start throw before ClickHouse accepts it, as a dropped connection would. */
  failNextStart(error: Error): void {
    this.#nextStartError = error;
  }

  /** Forgets every listed mutation, as ClickHouse does once it prunes finished ones. */
  prune(): void {
    this.#mutations.length = 0;
  }

  async materialiseTtl(): Promise<void> {
    const error = this.#nextStartError;
    this.#nextStartError = null;
    if (error) throw error;
    this.#started += 1;
    this.record({
      mutationId: `mutation_ttl_${this.#started}.txt`,
      isDone: false,
      partsToDo: 1,
      latestFailReason: "",
    });
  }
}
