/**
 * A question the picker adds to a board: its row, and the prompt Langy is drafted with.
 * The questions come from the dashboards catalogue.
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

/** What adding a question needs: the widget to store and the prompt to draft. */
export interface BlockQuestion {
  readonly id: string;
  readonly question: string;
  readonly why: string;
  readonly icon: BlockQuestionIcon;
  /** What Langy is asked: where the answer lives, over which window, in which shape. */
  readonly prompt: string;
}
