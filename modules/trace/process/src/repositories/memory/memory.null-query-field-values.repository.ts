import {
  TraceQueryFieldValuesRepository,
  type TraceQueryFieldValuesResult,
} from "../query-field-values.repository.ts";

export class MemoryNullQueryFieldValuesRepository extends TraceQueryFieldValuesRepository {
  private constructor() {
    super();
  }

  static create(): MemoryNullQueryFieldValuesRepository {
    return new MemoryNullQueryFieldValuesRepository();
  }

  async findAll(): Promise<TraceQueryFieldValuesResult> {
    return { values: [] };
  }
}
