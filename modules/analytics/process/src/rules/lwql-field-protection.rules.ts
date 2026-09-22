/**
 * Which read-time gate governs a column: input, output, or spend — the
 * three protections a viewer's `Protections` collapses to. Stated here
 * rather than imported, since nothing about a trace's projection reaches this package.
 */
export type FieldProtection = "input" | "output" | "costs";

/**
 * The protections a caller actually holds, as the set the catalogue and the
 * reference both gate on.
 */
export function heldFieldProtections(
  protections: Readonly<{
    canSeeCapturedInput?: boolean | null;
    canSeeCapturedOutput?: boolean | null;
    canSeeCosts?: boolean | null;
  }>,
): ReadonlySet<FieldProtection> {
  const held = new Set<FieldProtection>();
  if (protections.canSeeCapturedInput === true) held.add("input");
  if (protections.canSeeCapturedOutput === true) held.add("output");
  if (protections.canSeeCosts === true) held.add("costs");

  return held;
}
