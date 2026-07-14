/**
 * Turning a settled tool call into the follow-up chips to draw beneath its card.
 *
 * This is the JOIN of the two halves of the feature, kept JSX-free so it stays
 * unit-testable on its own:
 *   - `cliFollowUps.ts` answers WHICH offers a result earns (from the feature
 *     map's produces/consumes relation).
 *   - `logic/traceQueryIntent.ts` answers WHERE each offer lands (it recompiles
 *     the search's own input into a destination URL).
 *
 * An offer becomes a chip only when a builder can actually carry it — graph and
 * alert re-use the search's legacy filter shape verbatim, so no backend is
 * involved. Offers with no destination (dataset / annotation / lens — no link
 * exists for them yet) are silently dropped rather than rendered as dead ends,
 * per the spec's "a suggestion only appears when it can actually be carried out".
 *
 * @see specs/langy/langy-followup-suggestions.feature
 */
import {
  buildAlertHref,
  buildGraphHref,
  parseTraceQueryIntent,
  type TraceQueryIntent,
} from "../../logic/traceQueryIntent";
import { followUpsForResult } from "./cliFollowUps";

/** One resolved offer: its copy and the destination it carries the result to. */
export interface FollowUpChip {
  /** Stable per (result kind, target feature) — safe as a React key. */
  id: string;
  /** The chip's copy, e.g. "Graph these". */
  label: string;
  /** The pre-filtered destination the chip navigates to. */
  href: string;
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

  const intent = parseTraceQueryIntent(call.input);
  if (!intent) return [];

  const chips: FollowUpChip[] = [];
  for (const suggestion of suggestions) {
    const build = DESTINATION_BY_FEATURE[suggestion.featureId];
    if (!build) continue;
    const href = build({ projectSlug, intent });
    if (!href) continue;
    chips.push({ id: suggestion.id, label: suggestion.label, href });
  }
  return chips;
}
