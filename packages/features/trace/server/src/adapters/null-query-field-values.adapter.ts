import {
  TraceQueryFieldValuesPort,
  type TraceQueryFieldValuesResult,
} from "../ports/query-field-values.port";

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
