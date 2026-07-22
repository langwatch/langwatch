/**
 * Turning a settled tool call into the follow-up chips to draw beneath its card.
 *
 * This is the JOIN of the two halves of the feature, kept JSX-free so it stays
 * unit-testable on its own:
 *   - `cliFollowUps.ts` answers WHICH offers a result earns (from the feature
 *     map's produces/consumes relation).
 *   - `logic/traceQueryIntent.ts` answers WHERE a TRACE offer lands (it
 *     recompiles the search's own input into a pre-filtered destination URL).
 *
 * ── TWO GRADES OF DESTINATION ──────────────────────────────────────────────
 *
 * This used to bail entirely unless the call's input parsed as a trace query:
 *
 *     const intent = parseTraceQueryIntent(call.input);
 *     if (!intent) return [];
 *
 * `followUpsForResult` is perfectly generic — it works off the feature map, not
 * off traces — so that one line was the whole reason a question about spend, or
 * analytics, or anything that is not a trace search, earned no guidance at all.
 * Every offer the map derived was computed and then thrown away.
 *
 * So an offer now resolves at one of two grades, and its COPY tells you which:
 *
 *   CARRIED    a builder recompiled the result's own query into the destination,
 *              so the data goes with you. Keeps the offer's own verb —
 *              "Graph these" means these.
 *   PLAIN      no builder for this result kind, but the consuming feature has a
 *              surface. Reads "Open in Analytics" — an invitation to go and
 *              look, never a promise that the filter travelled.
 *
 * That distinction is the whole honesty of the feature. A chip saying "Graph
 * these" that lands on an unfiltered index is worse than no chip, which is why
 * the label is chosen by the destination it actually got, not by the offer.
 *
 * Carried chips sort first, and the list is capped — the point is a next step,
 * not a menu.
 *
 * @see specs/langy/langy-followup-suggestions.feature
 */
import {
  buildAlertHref,
  buildGraphHref,
  parseTraceQueryIntent,
  type TraceQueryIntent,
} from "../../logic/traceQueryIntent";
import {
  buildSurfaceHref,
  SURFACE_BY_FEATURE,
  SURFACE_LABEL,
} from "./capabilityRegistry";
import { followUpsForResult } from "./cliFollowUps";

/**
 * At most this many chips under one card. Beyond three the row stops reading as
 * "here is the obvious next step" and starts reading as a menu of everything
 * the product can do with your result.
 */
export const MAX_FOLLOW_UP_CHIPS = 3;

/** One resolved offer: its copy and the destination it takes the result to. */
export interface FollowUpChip {
  /** Stable per (result kind, target feature) — safe as a React key. */
  id: string;
  /** The chip's copy — "Graph these" when carried, "Open in X" when not. */
  label: string;
  /** The destination the chip navigates to. */
  href: string;
  /**
   * The result's own query was recompiled into the destination, so the data
   * travels with the click. False means the chip only opens the surface.
   */
  carried: boolean;
}

/** The slice of a settled tool call a chip is derived from. */
export interface SettledCall {
  name: string;
  state: string;
  input: unknown;
  output: unknown;
}

/**
 * Route a target feature to the builder that compiles the search into its
 * surface. Only offers present here can be carried out; every other offer is
 * dropped. Both builders re-use the legacy filter shape the search already ran
 * with, so graphing and alerting need no new backend.
 */
const DESTINATION_BY_FEATURE: Record<
  string,
  (args: {
    projectSlug: string | null;
    intent: TraceQueryIntent;
  }) => string | null
> = {
  "observability.analytics": buildGraphHref,
  triggers: buildAlertHref,
};

/**
 * The follow-up chips a settled call earns: the offers `cliFollowUps` derives,
 * routed to a destination and kept only when one exists. Choosing a chip only
 * NAVIGATES — the href carries the search across, it never acts on the user's
 * behalf.
 */
export function deriveFollowUpChips({
  call,
  projectSlug,
}: {
  call: SettledCall;
  projectSlug: string | null;
}): FollowUpChip[] {
  const suggestions = followUpsForResult({
    name: call.name,
    state: call.state,
    output: call.output,
  });
  if (suggestions.length === 0) return [];

  // Only trace searches can be recompiled into a filtered destination today.
  // A null intent is no longer fatal — it just means every offer resolves at
  // the plain grade instead of the carried one.
  const intent = parseTraceQueryIntent(call.input);

  const chips: FollowUpChip[] = [];
  for (const suggestion of suggestions) {
    const build = DESTINATION_BY_FEATURE[suggestion.featureId];
    const carriedHref = intent && build ? build({ projectSlug, intent }) : null;
    if (carriedHref) {
      chips.push({
        id: suggestion.id,
        label: suggestion.label,
        href: carriedHref,
        carried: true,
      });
      continue;
    }

    // No filter to carry. Offer the surface itself, worded so it cannot be
    // mistaken for one that brought the result along.
    const surface = SURFACE_BY_FEATURE[suggestion.featureId];
    if (!surface) continue;
    const href = buildSurfaceHref({ surface, projectSlug });
    if (!href) continue;
    chips.push({
      id: suggestion.id,
      label: `Open in ${SURFACE_LABEL[surface]}`,
      href,
      carried: false,
    });
  }

  // Carried offers first — a chip that brings the data with it is worth more
  // than one that merely opens a page — then cap.
  return chips
    .sort((a, b) => Number(b.carried) - Number(a.carried))
    .slice(0, MAX_FOLLOW_UP_CHIPS);
}
