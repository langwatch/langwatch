import type { TraceQueryFieldCatalogueInput } from "@langwatch/trace-contract";

export type TraceQueryFieldValuesInput = TraceQueryFieldCatalogueInput & {
  facetKey: string;
  limit: number;
  offset: number;
};

export type TraceQueryFieldValuesResult = {
  values: Array<{ value: string }>;
};

/** Composition port for the existing Trace facet read during its migration. */
export abstract class TraceQueryFieldValuesRepository {
  abstract list(input: TraceQueryFieldValuesInput): Promise<TraceQueryFieldValuesResult>;
}
