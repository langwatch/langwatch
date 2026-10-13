import {
  TraceIndexMaterialisationRepository,
  type UpdatedAtIndexMutation,
} from "../trace-index-materialisation.repository.ts";

/** In-memory `system.mutations` for the index: seeded and advanced by a test. */
export class MemoryTraceIndexMaterialisationRepository extends TraceIndexMaterialisationRepository {
  readonly #mutations: UpdatedAtIndexMutation[] = [];
  #issued = 0;

  static create(): MemoryTraceIndexMaterialisationRepository {
    return new MemoryTraceIndexMaterialisationRepository();
  }

  private constructor() {
    super();
  }

  /** Records a mutation as the newest, or replaces the one with the same id. */
  record(mutation: UpdatedAtIndexMutation): void {
    const at = this.#mutations.findIndex((each) => each.mutationId === mutation.mutationId);
    if (at >= 0) this.#mutations.splice(at, 1);
    this.#mutations.unshift(mutation);
  }

  /** How many times the materialisation was started. */
  issued(): number {
    return this.#issued;
  }

  async findUpdatedAtIndexMutations(): Promise<UpdatedAtIndexMutation[]> {
    return [...this.#mutations];
  }

  async materialiseUpdatedAtIndex(): Promise<void> {
    this.#issued += 1;
    this.record({
      mutationId: `mutation_memory_${this.#issued}.txt`,
      isDone: false,
      partsToDo: 1,
      latestFailReason: "",
    });
  }
}
