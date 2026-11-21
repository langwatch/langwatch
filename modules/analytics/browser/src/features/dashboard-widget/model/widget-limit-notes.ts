/**
 * The (i) line a card shows for what the server limited in a run (dashboards-v2 AC213). The
 * server's message is written for API readers; where it names a placeholder, the card says it
 * in its own words.
 */

import type {
  LangWatchQLDiagnostic,
  LangWatchQLDiagnosticCode,
} from "@langwatch/analytics-contract";

/** The diagnostics that say the server limited a run, shown on the card as one (i) line. */
const LIMIT_DIAGNOSTIC_CODES: readonly LangWatchQLDiagnosticCode[] = [
  "SHARE_WINDOW_LIMITED",
  "SOURCES_IGNORED",
  "GRANULARITY_COARSENED",
];

/** The card's words for a limiting diagnostic whose server message is not for a card. */
const CARD_WORDING: Readonly<Partial<Record<LangWatchQLDiagnosticCode, string>>> = {
  SOURCES_IGNORED:
    "This query counts every source, because its SQL does not read the sources setting.",
};

/** A run's limiting diagnostics as the card words them, in the order the server sent them. */
export function widgetLimitNotes(diagnostics: readonly LangWatchQLDiagnostic[]): string[] {
  return diagnostics
    .filter(({ code }) => LIMIT_DIAGNOSTIC_CODES.includes(code))
    .map(({ code, message }) => CARD_WORDING[code] ?? message);
}
