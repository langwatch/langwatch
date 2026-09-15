/**
 * Which read-time gate governs a column.
 *
 * The three protections a viewer's `Protections` collapses to: the captured
 * input, the captured output, and spend. Stated here rather than imported from
 * the trace projection catalogue because it is what the LangWatchQL view
 * catalogue declares against — a column is gated by one of these three, and
 * nothing about a trace's projection reaches this package.
 */
export type FieldProtection = "input" | "output" | "costs";
