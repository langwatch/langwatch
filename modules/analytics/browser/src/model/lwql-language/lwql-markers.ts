import type { LangWatchQLViolation } from "@langwatch/analytics-contract";

import type { LwqlEditorMarker } from "./lwql-marker.ts";

/** A violation the parser gave no position for is drawn at the start of the statement. */
const STATEMENT_START = { line: 1, column: 1 } as const;

/** The server's refusals as editor markers: its sentence, at the position it reported. */
export function lwqlMarkersFromViolations(
  violations: readonly LangWatchQLViolation[],
): readonly LwqlEditorMarker[] {
  return violations.map((violation) => ({
    message: violation.message,
    severity: "error",
    ...(violation.at ?? STATEMENT_START),
  }));
}
