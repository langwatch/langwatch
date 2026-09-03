/**
 * What one row of the trace table stands for. Each grouping mode renders a
 * different kind, and each kind has its own column and addon registry, so the
 * view store and the table registry have to agree on the vocabulary without
 * either owning the other.
 */
export type RowKind = "trace" | "conversation" | "group";
