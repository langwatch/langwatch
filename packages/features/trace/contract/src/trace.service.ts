import type { SpanTreeNode, SpanTreePage } from "./trace";
import type { TraceQueryFieldCatalogueInput } from "./trace-query.contract";
import type { SpanTreeDeltaInput, SpanTreeInput } from "./trace.queries";

/** Canonical trace reads closed under payload-parity review. */
export abstract class TraceService {
  abstract getSpanTreePage(input: SpanTreeInput): Promise<SpanTreePage>;

  abstract getSpanTreeDelta(input: SpanTreeDeltaInput): Promise<SpanTreeNode[]>;

  abstract buildQueryFieldCatalogue(
    input: TraceQueryFieldCatalogueInput,
  ): Promise<string>;
}
