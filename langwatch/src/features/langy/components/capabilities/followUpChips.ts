/**
 * Turning a settled tool call into the follow-up chips to draw beneath its card.
 *
 * This is the JOIN of the two halves of the feature, kept JSX-free so it stays
 * unit-testable on its own:
 *   - `cliFollowUps.ts` answers WHICH offers a result earns (from the feature
 *     map's produces/consumes relation).
 *   - `logic/traceExplorerLink.ts` answers WHERE a carried offer lands. It is
 *     the SAME reader the card's own "View in Trace Explorer" button uses
 *     (`readTraceSearchQuery`), so the chips and the card can never disagree
 *     about what the agent actually searched. The live transport hands us
 *     opencode's shell payload (`{ command: "langwatch trace search …" }` —
 *     the envelope retypes the NAME only), and that reader is the one that
 *     knows how to open it.
 *
 * ── TWO GRADES OF DESTINATION ──────────────────────────────────────────────
 *
 * An offer resolves at one of two grades, and its COPY tells you which:
 *
 *   CARRIED    a builder recompiled the search's own text into the destination,
 *              so the data goes with you. Keeps the offer's own verb —
 *              "Alert me on this" means THIS search.
 *   PLAIN      the destination cannot hold what this search expressed, but the
 *              consuming feature has a surface. Reads "Open in Analytics" — an
 *              invitation to go and look, never a promise that the query
 *              travelled.
 *
 * That distinction is the whole honesty of the feature, and it is why the
 * analytics offer is ALWAYS plain today: the graph builder filters on FIELDS
 * only (its API call has no free-text input), and the CLI's `trace search` has
 * no field flags — so there is nothing a graph could faithfully carry. A chip
 * saying "Graph these" that lands on an unfiltered builder is worse than no
 * chip. The one destination that CAN hold the search today is the automation
 * drawer, whose subject is a liqe query (`buildAutomationHref`).
 *
 * Carried chips sort first, and the list is capped — the point is a next step,
 * not a menu.
 *
 * @see specs/langy/langy-followup-suggestions.feature
 */
import {
  buildAutomationHref,
  readTraceSearchQuery,
  type TraceSearchQuery,
} from "../../logic/traceExplorerLink";
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
  /** The chip's copy — "Alert me on this" when carried, "Open in X" when not. */
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
 * surface. Only offers present here can be carried; every other offer resolves
 * at the plain grade. One entry today: the automation drawer already accepts a
 * liqe subject through its existing `initialFilterQuery` seed, so alerting
 * needs no new backend. Analytics is deliberately absent — see the module
 * header for why a carried graph would be a lie.
 */
const DESTINATION_BY_FEATURE: Record<
  string,
  (args: {
    projectSlug: string | null;
    search: TraceSearchQuery;
  }) => string | null
> = {
  triggers: buildAutomationHref,
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

  // The search as the agent actually ran it — read off the CLI command string
  // (or the older structured shape) by the same reader the card's Explorer
  // button uses. An input that is not a trace search reads as an empty search,
  // and every builder answers null on one, so those offers resolve plain.
  const search = readTraceSearchQuery(call.input);

  const chips: FollowUpChip[] = [];
  for (const suggestion of suggestions) {
    const build = DESTINATION_BY_FEATURE[suggestion.featureId];
    const carriedHref = build ? build({ projectSlug, search }) : null;
    if (carriedHref) {
      chips.push({
        id: suggestion.id,
        label: suggestion.label,
        href: carriedHref,
        carried: true,
      });
      continue;
    }

    // Nothing to carry. Offer the surface itself, worded so it cannot be
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
