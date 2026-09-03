/**
 * Which columns the annotations list can show, and which of them a reviewer
 * sees before they have said anything.
 *
 * A project that collects a dozen score types used to get a dozen columns,
 * nearly all of them empty on any given row, pushing input and output — the
 * two things a reviewer actually judges — into a narrow strip and the row's
 * actions off the right edge. So the score types now arrive folded into one
 * "Scores" column, and each type is still available on its own for anyone who
 * wants the matrix.
 */

/** One column the list can show, as the column picker names it. */
export interface AnnotationColumnOption {
  id: string;
  label: string;
  /** Grouping label inside the picker. */
  section: string;
  /** Whether it shows before the reviewer has chosen anything. */
  isVisibleByDefault: boolean;
}

/**
 * The columns the table always carries: picking rows, and the row's own
 * actions. Neither is content, so neither is offered in the picker — hiding
 * them would only ever cost the reviewer a way to act.
 */
export const FIXED_COLUMN_IDS = ["select", "actions"] as const;

/** What a per-score-type column's id starts with. */
export const SCORE_COLUMN_PREFIX = "score-";

export const scoreColumnId = (scoreTypeId: string) => `${SCORE_COLUMN_PREFIX}${scoreTypeId}`;

/** What the reviewer has chosen to show or hide, by column id. */
export type AnnotationColumnChoices = Record<string, boolean>;

const STANDARD = "Standard";
const SCORE_TYPES = "Score types";

/**
 * Every column on offer, in the order the table lays them out. The date
 * column is named by the page, because a queue dates a row by when it was
 * queued and the all annotations page by when it was last judged.
 */
export function annotationColumnOptions({
  dateColumnLabel,
  scoreTypes,
}: {
  dateColumnLabel: string;
  scoreTypes: { id: string; name: string }[];
}): AnnotationColumnOption[] {
  return [
    {
      id: "queuedBy",
      label: "People",
      section: STANDARD,
      isVisibleByDefault: true,
    },
    {
      id: "date",
      label: dateColumnLabel,
      section: STANDARD,
      isVisibleByDefault: true,
    },
    {
      id: "input",
      label: "Input",
      section: STANDARD,
      isVisibleByDefault: true,
    },
    {
      id: "output",
      label: "Output",
      section: STANDARD,
      isVisibleByDefault: true,
    },
    {
      id: "scores",
      label: "Scores",
      section: STANDARD,
      isVisibleByDefault: true,
    },
    {
      id: "comments",
      label: "Comments",
      section: STANDARD,
      isVisibleByDefault: true,
    },
    {
      id: "suggestions",
      label: "Suggestions",
      section: STANDARD,
      isVisibleByDefault: true,
    },
    // Off by default: the folded "Scores" column already says what every
    // reviewer answered, and one column per type is what made the list
    // unreadable for the projects that collect many.
    ...scoreTypes.map((scoreType) => ({
      id: scoreColumnId(scoreType.id),
      label: scoreType.name,
      section: SCORE_TYPES,
      isVisibleByDefault: false,
    })),
  ];
}

/**
 * Whether a column shows: what the reviewer chose for it, and its own default
 * where they have chosen nothing. Reading the default per column rather than
 * storing the visible set is what lets a column added later — a new score type
 * among them — arrive as its author intended instead of silently hidden.
 */
export function isColumnVisible({
  column,
  choices,
}: {
  column: AnnotationColumnOption;
  choices: AnnotationColumnChoices;
}): boolean {
  return choices[column.id] ?? column.isVisibleByDefault;
}

/** The ids the table renders, fixed columns included, in table order. */
export function visibleColumnIds({
  columns,
  choices,
}: {
  columns: AnnotationColumnOption[];
  choices: AnnotationColumnChoices;
}): string[] {
  return [
    "select",
    ...columns.filter((column) => isColumnVisible({ column, choices })).map((column) => column.id),
    "actions",
  ];
}
