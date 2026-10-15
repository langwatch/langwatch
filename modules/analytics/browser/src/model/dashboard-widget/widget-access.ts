/**
 * The words of a widget's "no access" state: what is withheld, and who to ask. The server says
 * which gates the reader lacks; nothing here names a column, a value or the query.
 * The rules: features/dashboards/WIDGET_STANDARD.md.
 */

/** The permission a built-in Viewer or Lite member lacks. */
const COST_GATE = "cost:view";

export interface WithheldWords {
  /** What is withheld: "Cost figures are hidden for your role". */
  readonly what: string;
  /** Who to ask: "Ask an admin of Checkout Agent if you need to see them." */
  readonly ask: string;
}

/** The state's two lines for the gates a reader lacks, in the project they are reading. */
export function withheldWords({
  missingGates,
  projectName,
}: {
  missingGates: readonly string[];
  /** Absent before the project has resolved; the line then says "the project". */
  projectName: string | undefined;
}): WithheldWords {
  const isCostOnly = missingGates.length > 0 && missingGates.every((gate) => gate === COST_GATE);
  const admin = `an admin of ${projectName ?? "the project"}`;
  return isCostOnly
    ? {
        what: "Cost figures are hidden for your role",
        ask: `Ask ${admin} if you need to see them.`,
      }
    : { what: "This data is hidden for your role", ask: `Ask ${admin} if you need to see it.` };
}
