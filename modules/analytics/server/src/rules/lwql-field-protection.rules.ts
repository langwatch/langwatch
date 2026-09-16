/**
 * Which read-time gate governs a column: input, output, or spend — the
 * three protections a viewer's `Protections` collapses to. Stated here
 * rather than imported, since nothing about a trace's projection reaches this package.
 */
export type FieldProtection = "input" | "output" | "costs";
