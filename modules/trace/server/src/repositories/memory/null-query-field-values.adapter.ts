import {
  TraceQueryFieldValuesRepository,
  type TraceQueryFieldValuesResult,
} from "../read/query-field-values.repository.ts";

export class NullQueryFieldValuesAdapter extends TraceQueryFieldValuesRepository {
  private constructor() {
    super();
  }

  static create(): NullQueryFieldValuesAdapter {
    return new NullQueryFieldValuesAdapter();
  }

  async list(): Promise<TraceQueryFieldValuesResult> {
    return { values: [] };
  }
}
