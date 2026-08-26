import type {
  CategoricalFacetResult,
  DiscreteFacetResult,
  FacetCountResult,
  TraceListPage,
  TraceListRepository,
} from "@langwatch/trace-contract";

export class NullTraceListAdapter implements TraceListRepository {
  private constructor() {}

  static create(): NullTraceListAdapter {
    return new NullTraceListAdapter();
  }

  async findAll(): Promise<TraceListPage> {
    return { rows: [], totalHits: 0 };
  }

  async findFacetCounts(): Promise<FacetCountResult> {
    return { values: {} };
  }

  async findRangeStats(): Promise<{ min: number; max: number }> {
    return { min: 0, max: 0 };
  }

  async findCount(): Promise<number> {
    return 0;
  }

  async findDistinctValues(): Promise<string[]> {
    return [];
  }

  async findCategoricalFacet(): Promise<CategoricalFacetResult> {
    return { values: [], totalDistinct: 0 };
  }

  async findCategoricalFacetRaw(): Promise<CategoricalFacetResult> {
    return { values: [], totalDistinct: 0 };
  }

  async findRangeStatsForTable(): Promise<{ min: number; max: number }> {
    return { min: 0, max: 0 };
  }

  async findDiscreteValues(): Promise<DiscreteFacetResult> {
    return { values: [], distinctCount: 0 };
  }

  async findBatchedFacets() {
    return { categoricals: {}, ranges: {} };
  }

  async findAttributeValues(): Promise<CategoricalFacetResult> {
    return { values: [], totalDistinct: 0 };
  }
}
