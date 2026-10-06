/**
 * The picker's shapes: a question row and the section it sits in, each question
 * carrying the prompt Langy is drafted with, and the search over them. The
 * contents come from the dashboards catalogue.
 */

/** The icon a question row shows; the picker maps each name to a glyph. */
export type BlockQuestionIcon =
  | "gauge"
  | "activity"
  | "trendingDown"
  | "coins"
  | "messageSquare"
  | "alertTriangle"
  | "xCircle"
  | "flaskConical"
  | "gitCompare"
  | "dollarSign"
  | "cpu"
  | "helpCircle"
  | "scale";

export interface BlockQuestion {
  readonly id: string;
  readonly question: string;
  readonly why: string;
  readonly icon: BlockQuestionIcon;
  /** What Langy is asked: where the answer lives, over which window, in which shape. */
  readonly prompt: string;
  /** Listed but not yet built: shown, and cannot be picked. */
  readonly comingSoon?: boolean;
}

export interface BlockQuestionSection {
  readonly id: string;
  readonly title: string;
  readonly why: string;
  /** A short, user-facing line for what a board made from this section shows. */
  readonly summary: string;
  /** A design-system colour palette tinting the section title and its icons. */
  readonly palette: string;
  readonly questions: readonly BlockQuestion[];
}

/**
 * The sections whose questions match a search, matching on the question, its
 * reason and the section title; a section with no match is dropped.
 */
export function searchBlockQuestions({
  sections,
  search,
}: {
  sections: readonly BlockQuestionSection[];
  search: string;
}): BlockQuestionSection[] {
  const needle = search.trim().toLowerCase();
  if (!needle) return [...sections];
  return sections
    .map((section) => ({
      ...section,
      questions: section.questions.filter((question) =>
        `${question.question} ${question.why} ${section.title}`.toLowerCase().includes(needle),
      ),
    }))
    .filter((section) => section.questions.length > 0);
}
