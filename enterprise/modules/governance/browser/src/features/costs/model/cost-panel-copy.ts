// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { CHART_SEAT_CONTRACT_FILL, CHART_SEAT_FILL } from "./chart-theme.ts";

/**
 * The seat chart's two series, coloured apart.
 *
 * Both hues come from the shared chart theme rather than being picked here, so
 * that these bars and the per-pool meter in the lane card cannot drift into two
 * different colours for one subject — which is exactly what they had done, in
 * two blues a reader could not tell apart. The reasoning is on the constants.
 */
export const SEAT_SERIES_COLORS: Record<string, string> = {
  bought: CHART_SEAT_CONTRACT_FILL,
  assigned: CHART_SEAT_FILL,
};

/** Where a reader goes to make an empty panel stop being empty. */
export const ADD_A_SOURCE = {
  label: "Add a source",
  to: "/governance/inventory?tab=sources",
} as const;
export const MANAGE_DEPARTMENTS = {
  label: "Manage departments",
  to: "/governance/people?tab=departments",
} as const;

/**
 * The panels below that HAVE NO READ BEHIND THEM YET.
 *
 * Four panels existed only under sample mode — the two agent breakdowns, the
 * agent forecast, and the conversation and token counts — so a reader who
 * turned the sample off watched half the screen disappear and had no way to
 * tell a panel that is coming from a panel that was never there. They are
 * drawn in both modes now, and outside sample mode they draw their empty
 * state.
 *
 * AN EMPTY ARRAY, NOT NULL, AND THAT IS A DELIBERATE OVERSTATEMENT. Null on
 * this screen means "no read has answered" and an empty array means "a read
 * answered and found nothing", and these panels are in the first state while
 * saying the second. It is the wording the product owner asked for, and it is
 * true of the store as it stands — the cost rollup carries an agent column
 * that is blank on every row it holds, and the metered lane these counts
 * would come from holds no rows at all — so "nothing in this window yet" is
 * not a lie about the money today. It WILL become one the day either of those
 * fills, because nothing here is measuring anything. Whoever wires the read
 * takes this constant out with it.
 */
export const AWAITING_A_READ: [] = [];

/**
 * The same user-grouped panel for real data, samples, empty and failed reads.
 * Provider-reported cost stays separate from costs recorded on traces.
 */
export const PROVIDER_REPORTED_BY_USER = "Provider-reported spend by user";

/**
 * What the agent panels say while nothing attributes spend to an agent.
 *
 * One sentence, three panels. Each of them is blank for the same reason and
 * fills on the same event, and three copies of that sentence is three places
 * for it to drift out of agreement with the other two.
 */
export const AGENTS_ARE_UNATTRIBUTED = {
  source: "Fills once a source reports which agent spent the money.",
  action: ADD_A_SOURCE,
} as const;
