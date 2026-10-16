import {
  CodingAgentSessionIndexMaterialisationRepository,
  type SessionIdIndexMutation,
} from "../coding-agent-session-index-materialisation.repository.ts";

/** In-memory `system.mutations` for the index: seeded and advanced by a test. */
export class MemoryCodingAgentSessionIndexMaterialisationRepository extends CodingAgentSessionIndexMaterialisationRepository {
  readonly #mutations: SessionIdIndexMutation[] = [];
  #issued = 0;

  static create(): MemoryCodingAgentSessionIndexMaterialisationRepository {
    return new MemoryCodingAgentSessionIndexMaterialisationRepository();
  }

  private constructor() {
    super();
  }

  /** Records a mutation as the newest, or replaces the one with the same id. */
  record(mutation: SessionIdIndexMutation): void {
    const at = this.#mutations.findIndex((each) => each.mutationId === mutation.mutationId);
    if (at >= 0) this.#mutations.splice(at, 1);
    this.#mutations.unshift(mutation);
  }

  /** How many times the materialisation was started. */
  issued(): number {
    return this.#issued;
  }

  async findSessionIdIndexMutations(): Promise<SessionIdIndexMutation[]> {
    return [...this.#mutations];
  }

  async materialiseSessionIdIndex(): Promise<void> {
    this.#issued += 1;
    this.record({
      mutationId: `mutation_memory_${this.#issued}.txt`,
      isDone: false,
      partsToDo: 1,
      latestFailReason: "",
    });
  }
}
