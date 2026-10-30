/**
 * The one product event for a question a member puts to Langy, wherever they ask it:
 * `langy.asked.question` once the host composes it. It carries where it was asked, never the text.
 * @see modules/dashboard/specs/dashboards-telemetry.feature
 */

/** Where a member asked: the Langy composer, a board's ask bar, or "Add a widget". */
export const LANGY_ASK_SURFACES = ["composer", "ask_bar", "add_widget"] as const;
/** One place a member can ask Langy from. */
export type LangyAskSurface = (typeof LANGY_ASK_SURFACES)[number];

/** The event, shaped as the browser host's analytics event; never the question's text. */
export type LangyQuestionAskedEvent = Readonly<{
  boundary: "langy";
  action: "asked";
  name: "question";
  attributes: Readonly<{ surface: LangyAskSurface }>;
}>;

/** A question a member sent to Langy. */
export function langyQuestionAsked({
  surface,
}: {
  surface: LangyAskSurface;
}): LangyQuestionAskedEvent {
  return { boundary: "langy", action: "asked", name: "question", attributes: { surface } };
}
