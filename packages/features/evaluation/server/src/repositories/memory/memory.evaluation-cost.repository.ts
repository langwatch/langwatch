import {
  EvaluationCostAlreadyRecordedError,
  type EvaluationCostReference,
  type EvaluationCostRepository,
  type EvaluationCostRow,
} from "../evaluation-cost.repository.ts";

/** The same ledger over a map, refusing a taken id the way the table does. */
export class MemoryEvaluationCostRepository implements EvaluationCostRepository {
  readonly #rows = new Map<string, EvaluationCostRow>();

  private constructor() {}

  static create(): MemoryEvaluationCostRepository {
    return new MemoryEvaluationCostRepository();
  }

  async create(input: EvaluationCostRow): Promise<void> {
    if (this.#rows.has(input.id)) throw new EvaluationCostAlreadyRecordedError(input.id);

    this.#rows.set(input.id, input);
  }

  async findById(input: {
    id: string;
    projectId: string;
  }): Promise<EvaluationCostReference | undefined> {
    const row = this.#rows.get(input.id);

    return row && row.projectId === input.projectId ? { id: row.id } : undefined;
  }
}
