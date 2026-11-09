import {
  TraceIndexMaterialisationRepository,
  type MaterialisationMutation,
} from "../trace-index-materialisation.repository.ts";

/** One materialisation's `system.mutations` rows and how many times it was started. */
class MemoryMaterialisation {
  readonly mutations: MaterialisationMutation[] = [];
  issued = 0;

  record(mutation: MaterialisationMutation): void {
    const at = this.mutations.findIndex((each) => each.mutationId === mutation.mutationId);
    if (at >= 0) this.mutations.splice(at, 1);
    this.mutations.unshift(mutation);
  }

  start(): void {
    this.issued += 1;
    this.record({
      mutationId: `mutation_memory_${this.issued}.txt`,
      isDone: false,
      partsToDo: 1,
      latestFailReason: "",
    });
  }
}

/** In-memory `system.mutations` for the index and the metadata columns: seeded by a test. */
export class MemoryTraceIndexMaterialisationRepository extends TraceIndexMaterialisationRepository {
  readonly #index = new MemoryMaterialisation();
  readonly #metadataColumns = new MemoryMaterialisation();

  static create(): MemoryTraceIndexMaterialisationRepository {
    return new MemoryTraceIndexMaterialisationRepository();
  }

  private constructor() {
    super();
  }

  /** Records an index mutation as the newest, or replaces the one with the same id. */
  record(mutation: MaterialisationMutation): void {
    this.#index.record(mutation);
  }

  /** How many times the index materialisation was started. */
  issued(): number {
    return this.#index.issued;
  }

  /** Records a metadata-column mutation as the newest, or replaces the one with the same id. */
  recordAnalyticsMetadataColumns(mutation: MaterialisationMutation): void {
    this.#metadataColumns.record(mutation);
  }

  /** How many times the metadata columns' materialisation was started. */
  issuedAnalyticsMetadataColumns(): number {
    return this.#metadataColumns.issued;
  }

  async findUpdatedAtIndexMutations(): Promise<MaterialisationMutation[]> {
    return [...this.#index.mutations];
  }

  async materialiseUpdatedAtIndex(): Promise<void> {
    this.#index.start();
  }

  async findAnalyticsMetadataColumnMutations(): Promise<MaterialisationMutation[]> {
    return [...this.#metadataColumns.mutations];
  }

  async materialiseAnalyticsMetadataColumns(): Promise<void> {
    this.#metadataColumns.start();
  }
}
