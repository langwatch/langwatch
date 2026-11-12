import {
  BillableEventsTtlRepository,
  type TtlMutation,
} from "../billable-events-ttl.repository.ts";

/** In-memory `system.mutations` for the TTL materialisation: seeded by a test. */
export class MemoryBillableEventsTtlRepository extends BillableEventsTtlRepository {
  readonly #mutations: TtlMutation[] = [];
  #started = 0;

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

  async materialiseTtl(): Promise<void> {
    this.#started += 1;
    this.record({
      mutationId: `mutation_ttl_${this.#started}.txt`,
      isDone: false,
      partsToDo: 1,
      latestFailReason: "",
    });
  }
}
