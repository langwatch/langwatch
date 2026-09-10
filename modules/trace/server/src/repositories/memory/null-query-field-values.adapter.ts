import {
  TraceQueryFieldValuesPort,
  type TraceQueryFieldValuesResult,
} from "../read/query-field-values.repository.ts";

export class NullQueryFieldValuesAdapter extends TraceQueryFieldValuesPort {
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
