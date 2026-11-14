/**
 * The only text a typed read writes that the builder did not compose (ADR-202, "Values are named
 * parameters only"). Each entry names the one table it reads and why it was let in; a guard test
 * refuses an entry that names a tenant, a setting or a parameter slot.
 */
export const REVIEWED_FRAGMENTS = {
  "spans.responseModel": {
    table: "stored_spans",
    sql: "coalesce(nullIf(SpanAttributes['gen_ai.response.model'], ''), SpanAttributes['gen_ai.request.model'])",
    reviewed: "The trace span repository's model column: one row's own attributes, no filter.",
  },
} as const satisfies Record<string, { table: string; sql: string; reviewed: string }>;

export type ReviewedFragmentId = keyof typeof REVIEWED_FRAGMENTS;
