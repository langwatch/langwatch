/**
 * Turning a settled tool call into the follow-up chips to draw beneath its card.
 * @see specs/langy/langy-followup-suggestions.feature
 */
import { buildAutomationHref, readTraceSearchQuery } from "../../../../index";
import type { TraceSearchQuery, UnstatedWindow } from "../../../../index";
import { buildSurfaceHref, SURFACE_BY_FEATURE, SURFACE_LABEL } from "./capability-registry";
import { followUpsForResult } from "./cli-follow-ups";

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
 * Route a target feature to the builder that compiles the search into its surface. Only
 * offers present here can be carried; every other offer resolves at the plain grade.
 */
const DESTINATION_BY_FEATURE: Record<
  string,
  (args: {
    projectSlug: string | null;
    search: TraceSearchQuery;
    unstatedWindow?: UnstatedWindow;
  }) => string | null
> = {
  triggers: buildAutomationHref,
};

/**
 * Result kinds whose offers never resolve at the PLAIN grade. A plain chip is "go and
 * look" — honest only when the destination shows the thing that earned the offer.
 */
const PLAIN_INELIGIBLE_KINDS = new Set(["evaluators", "prompts"]);

/**
 * The follow-up chips a settled call earns: the offers `cliFollowUps` derives, routed
 * to a destination and kept only when one exists. Choosing a chip only NAVIGATES — the
 * href carries the search across, it never acts on the user's behalf.
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
    // `search` was read off a settled `langwatch trace search` call above, so an
    // absent window here is the CLI's own last-24h default rather than an
    // unknown one — the alert must match the traces the card just showed.
    const carriedHref = build
      ? build({ projectSlug, search, unstatedWindow: "cli-last-24h" })
      : null;
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
    // mistaken for one that brought the result along — unless the destination
    // could not even SHOW the result's kind, in which case no chip at all.
    if (PLAIN_INELIGIBLE_KINDS.has(suggestion.kind)) continue;
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
  return chips.sort((a, b) => Number(b.carried) - Number(a.carried)).slice(0, MAX_FOLLOW_UP_CHIPS);
}
