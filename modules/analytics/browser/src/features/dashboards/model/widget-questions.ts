/**
 * A question the "Add a widget" picker adds to a board: its row, and the prompt Langy is
 * drafted with. The questions come from the dashboards catalogue.
 */

/** The icon a question row shows, by the shape of its question; the picker maps each to a glyph. */
export type WidgetQuestionIcon =
  | "activity"
  | "trendingDown"
  | "alertTriangle"
  | "gitCompare"
  | "helpCircle"
  | "gauge"
  | "scale";

/** What adding a question needs: the widget to store and the prompt to draft. */
export interface WidgetQuestion {
  readonly id: string;
  readonly question: string;
  readonly why: string;
  readonly icon: WidgetQuestionIcon;
  /** What Langy is asked: where the answer lives, over which window, in which shape. */
  readonly prompt: string;
}
